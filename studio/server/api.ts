// HTTP API of the Studio, mounted by dev.mjs under /api/studio. Routes are listed in studio/shared/types.ts.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Asset, Concept, NewProject, PlanItem, ProjectCard, ProjectPatch, ProjectView, RunRequest, StudioStatus } from '../shared/types.ts'
import { ACTIVE_JOB, GROUP_LABEL } from '../shared/types.ts'
import { ANTHROPIC_KEY, CLAUDE_MODEL, buildPlan, chooseDirection, draftCaseStudy, proposeConcepts, revisePrompt } from './director.ts'
import { DEFAULT_MODEL, fit, getAdapter, modelInfo, pricing, pricingCoverage, refreshPricing } from './models.ts'
import { FAL_KEY, MAX_CONCURRENCY, Refusal, assemble, cancel, committed, costs, hasFfmpeg, patchAsset, quote, recover, run, tick } from './production.ts'
import { type Stored, DATA_DIR, all, filePath, filesDir, get, loadAll, newId, now, remove, save, writeFile } from './store.ts'
import { zip } from './zip.ts'

const BASE = '/api/studio'

// ---------- Boot ----------

export async function startStudio(): Promise<{ projects: number; dataDir: string }> {
  const projects = loadAll().length
  recover()
  await refreshPricing(FAL_KEY)
  setInterval(() => void refreshPricing(FAL_KEY), 6 * 3600_000).unref()
  setInterval(tick, 2000).unref()
  tick()
  return { projects, dataDir: DATA_DIR }
}

export const studioConfig = () => ({ anthropic: !!ANTHROPIC_KEY, fal: !!FAL_KEY, pricing: pricing.error ? `unavailable (${pricing.error})` : `${pricingCoverage().known}/${pricingCoverage().total} endpoints priced` })

// ---------- Helpers ----------

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const refuse = (code: string, message: string) => new Refusal(code, message)

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw refuse('invalid', `Upload is larger than ${Math.round(limit / 1e6)} MB`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = (await readBody(req, 2_000_000)).toString('utf8')
  if (!raw.trim()) return {} as T
  try {
    return JSON.parse(raw) as T
  } catch {
    throw refuse('invalid', 'The request body is not valid JSON')
  }
}

function view(p: Stored): ProjectView {
  const { idem: _idem, uploads: _uploads, ...project } = p
  return { ...project, costs: costs(p) }
}

function card(p: Stored): ProjectCard {
  const images = p.assets.filter((a) => a.kind === 'image' || a.dryRun)
  const cover = images.find((a) => a.preferred && a.status === 'approved') ?? [...images].reverse().find((a) => a.origin === 'generated' && a.status !== 'rejected') ?? images.find((a) => a.origin === 'reference')
  const c = costs(p)
  return {
    id: p.id,
    name: p.name,
    stage: p.stage,
    updatedAt: p.updatedAt,
    live: p.live,
    coverUrl: cover?.url ?? null,
    assetCount: p.assets.filter((a) => a.origin !== 'reference').length,
    approvedCount: p.assets.filter((a) => a.origin !== 'reference' && a.status === 'approved').length,
    activeJobs: p.jobs.filter((j) => ACTIVE_JOB.includes(j.status)).length,
    spentUsd: c.spentUsd,
    budgetUsd: p.approvedBudgetUsd,
  }
}

const text = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const money = (v: unknown): number | null | undefined => (v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined)

function applyBrief(p: Stored, b: ProjectPatch['brief']): void {
  if (!b) return
  for (const key of ['text', 'brand', 'product', 'audience', 'objective', 'deliverables', 'aesthetic'] as const) {
    const v = text(b[key], key === 'text' ? 20000 : 2000)
    if (v !== undefined) p.brief[key] = v
  }
  if (Array.isArray(b.aspects)) p.brief.aspects = b.aspects.filter((a) => typeof a === 'string').slice(0, 7)
}

/** Apply user edits to a plan item, keeping it executable by its model. */
function applyItem(p: Stored, item: PlanItem, patch: Partial<PlanItem>): void {
  for (const key of ['title', 'purpose', 'description', 'prompt', 'modelReason'] as const) {
    const v = text(patch[key], 8000)
    if (v !== undefined) item[key] = v
  }
  if (patch.group && patch.group in GROUP_LABEL && patch.group !== 'final_video' && item.group !== 'final_video') item.group = item.kind === 'video' ? 'video_shot' : patch.group === 'video_shot' ? item.group : patch.group
  if (patch.modelId !== undefined && patch.modelId !== item.modelId) {
    const a = getAdapter(patch.modelId)
    if (!a || a.kind !== item.kind) throw refuse('invalid', `“${patch.modelId}” is not a ${item.kind} model`)
    item.modelId = a.id
    if (patch.modelReason === undefined) item.modelReason = ''
  }
  if (typeof patch.aspect === 'string') item.aspect = patch.aspect
  if (typeof patch.resolution === 'string') item.resolution = patch.resolution
  if (typeof patch.durationSec === 'number') item.durationSec = patch.durationSec
  if (typeof patch.variations === 'number') item.variations = patch.variations
  if (typeof patch.useBriefReferences === 'boolean') item.useBriefReferences = patch.useBriefReferences
  if (Array.isArray(patch.dependsOn)) {
    const valid = patch.dependsOn.filter((id) => id !== item.id && p.plan!.items.some((i) => i.id === id && i.kind === 'image'))
    item.dependsOn = item.kind === 'video' ? valid.slice(0, 1) : valid
  }
  if ('pinnedAssetId' in patch) {
    const a = patch.pinnedAssetId ? p.assets.find((x) => x.id === patch.pinnedAssetId && x.kind === 'image') : undefined
    item.pinnedAssetId = a?.id
  }
  const adapter = getAdapter(item.modelId)
  if (adapter) {
    const f = fit(adapter, { aspect: item.aspect, resolution: item.resolution, durationSec: item.durationSec, count: item.variations })
    item.aspect = f.aspect
    item.resolution = f.resolution
    item.durationSec = f.durationSec
    item.variations = f.count
  }
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }

function serveFile(req: IncomingMessage, res: ServerResponse, projectId: string, name: string): void {
  const file = path.join(filesDir(projectId), path.basename(name))
  if (!get(projectId) || !existsSync(file)) return send(res, 404, { error: 'No such file', code: 'not_found' })
  const size = statSync(file).size
  const headers: Record<string, string | number> = {
    'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream',
    'cache-control': 'private, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
    // Stored media is never executed as a page, even an SVG opened directly.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      return void res.end()
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
    return void createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...headers, 'content-length': size })
  createReadStream(file).pipe(res)
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'asset'

function exportZip(p: Stored): Buffer {
  const made = p.assets.filter((a) => a.origin !== 'reference' && a.status !== 'rejected')
  const approved = made.filter((a) => a.status === 'approved' && !a.dryRun)
  const chosen = approved.length ? approved : made
  const files: { name: string; data: Buffer }[] = []
  const manifest: unknown[] = []
  const counter = new Map<string, number>()
  for (const a of chosen) {
    const file = filePath(p.id, a.url)
    if (!existsSync(file)) continue
    const item = p.plan?.items.find((i) => i.id === a.itemId)
    const job = p.jobs.find((j) => j.id === a.jobId)
    const base = `${slug(item ? GROUP_LABEL[item.group] : 'other')}/${a.dryRun ? 'DRY-RUN-' : ''}${slug(item?.title ?? 'asset')}`
    const n = (counter.get(base) ?? 0) + 1
    counter.set(base, n)
    const name = `${base}-${n}${path.extname(file)}`
    files.push({ name, data: readFileSync(file) })
    manifest.push({ file: name, title: item?.title, group: item?.group, kind: a.kind, status: a.status, preferred: a.preferred, dryRunPlaceholder: a.dryRun, model: a.modelId, endpoint: job?.endpoint, prompt: a.prompt, estimatedUsd: job?.estimate.usd ?? null, actualUsd: job?.actualUsd ?? null, createdAt: a.createdAt })
  }
  const c = costs(p)
  files.push({
    name: 'campaign.json',
    data: Buffer.from(
      JSON.stringify(
        {
          notice: 'Speculative creative work. Not commissioned by a client. No performance results are claimed.',
          campaign: p.plan?.campaignTitle ?? p.name,
          brief: p.brief,
          direction: p.direction,
          continuity: p.plan?.continuity,
          costs: { mediaSpentUsd: c.spentUsd, confirmedByFalUsd: c.actualUsd, imageUsd: c.imageUsd, videoUsd: c.videoUsd, claudeEstimateUsd: c.llmUsd, jobsWithUnknownCost: c.unknownJobs },
          assets: manifest,
        },
        null,
        2,
      ),
    ),
  })
  if (p.caseStudy) files.push({ name: 'case-study.md', data: Buffer.from(p.caseStudy) })
  return zip(files)
}

// ---------- Router ----------

/** Returns false when the URL is not a Studio route. */
export async function handleStudio(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return false
  const method = req.method ?? 'GET'
  const seg = url.pathname
    .slice(BASE.length)
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)

  try {
    // This API can spend money: accept changes only from this app's own pages.
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin
      if (origin && new URL(origin).host !== req.headers.host) throw refuse('invalid', 'Cross-origin requests are not accepted')
    }

    if (seg[0] === 'status' && method === 'GET') {
      const status: StudioStatus = {
        anthropic: !!ANTHROPIC_KEY,
        fal: !!FAL_KEY,
        claudeModel: CLAUDE_MODEL,
        pricing: { fetchedAt: pricing.fetchedAt, ...pricingCoverage(), error: pricing.error },
        assembly: await hasFfmpeg,
        maxConcurrency: MAX_CONCURRENCY,
        models: modelInfo(),
      }
      return send(res, 200, status), true
    }

    if (seg[0] === 'files' && seg.length === 3 && (method === 'GET' || method === 'HEAD')) return serveFile(req, res, seg[1], seg[2]), true

    if (seg[0] !== 'projects') throw refuse('not_found', 'No such route')

    if (seg.length === 1) {
      if (method === 'GET') {
        return send(res, 200, all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(card)), true
      }
      if (method === 'POST') {
        const body = await readJson<NewProject>(req)
        const briefText = text(body.brief?.text, 20000)?.trim()
        if (!briefText) throw refuse('invalid', 'Write a brief first')
        const p: Stored = {
          id: newId('prj'),
          name: text(body.name, 120)?.trim() || text(body.brief.brand, 120)?.trim() || briefText.split(/\s+/).slice(0, 6).join(' '),
          createdAt: now(),
          updatedAt: now(),
          stage: 'brief',
          brief: { text: briefText, referenceAssetIds: [] },
          mode: body.mode && body.mode in DEFAULT_MODEL ? body.mode : 'balanced',
          maxBudgetUsd: money(body.maxBudgetUsd) ?? null,
          approvedBudgetUsd: null,
          live: false,
          paused: false,
          concepts: [],
          direction: null,
          plan: null,
          jobs: [],
          assets: [],
          log: [],
          llm: [],
          caseStudy: null,
          agentTask: null,
          agentError: null,
          idem: [],
          uploads: {},
        }
        applyBrief(p, body.brief)
        p.log.push({ id: newId('log'), at: now(), role: 'user', text: briefText })
        save(p)
        return send(res, 200, view(p)), true
      }
    }

    const p = get(seg[1])
    if (!p) throw refuse('not_found', 'No such project')
    const [, , a, b, c, d] = seg
    const done = () => (send(res, 200, view(p)), true)

    if (!a) {
      if (method === 'GET') {
        tick()
        return done()
      }
      if (method === 'DELETE') {
        if (p.jobs.some((j) => ACTIVE_JOB.includes(j.status) && j.status !== 'pending' && !j.dryRun)) throw refuse('busy', 'Generations are running on fal. Cancel them or let them finish before deleting the project.')
        remove(p.id)
        return send(res, 200, { ok: true }), true
      }
      if (method === 'PATCH') {
        const patch = await readJson<ProjectPatch>(req)
        const name = text(patch.name, 120)?.trim()
        if (name) p.name = name
        applyBrief(p, patch.brief)
        if (patch.mode && patch.mode in DEFAULT_MODEL) p.mode = patch.mode
        const max = money(patch.maxBudgetUsd)
        if (max !== undefined) p.maxBudgetUsd = max
        if (patch.approvedBudgetUsd !== undefined) {
          const cap = money(patch.approvedBudgetUsd)
          if (cap == null || cap <= 0) throw refuse('invalid', 'The budget must be a positive amount')
          if (cap < committed(p) - 1e-9) throw refuse('budget', `The budget cannot be lower than the $${committed(p).toFixed(2)} already committed`)
          p.approvedBudgetUsd = cap
        }
        if (patch.clearAgentError) p.agentError = null
        if (typeof patch.paused === 'boolean') p.paused = patch.paused
        if (typeof patch.live === 'boolean' && patch.live !== p.live) {
          if (patch.live) {
            if (!FAL_KEY) throw refuse('not_configured', 'FAL_KEY is not set on the server, so live generation is not possible')
            if (!patch.confirmLive) throw refuse('invalid', 'Switching to live generation needs explicit confirmation')
            p.log.push({ id: newId('log'), at: now(), role: 'system', text: 'Live mode on: approved generations now run on fal.ai and are charged to your account.' })
          } else p.log.push({ id: newId('log'), at: now(), role: 'system', text: 'Dry run on: generations produce placeholders and cost nothing.' })
          p.live = patch.live
        }
        if (patch.stage && ['brief', 'concepts', 'plan', 'production', 'delivery'].includes(patch.stage)) p.stage = patch.stage
        save(p)
        tick()
        return done()
      }
    }

    if (a === 'references') {
      if (method === 'POST' && !b) {
        const mime = String(req.headers['content-type'] ?? '').split(';')[0]
        if (!IMAGE_EXT[mime]) throw refuse('invalid', 'References must be PNG, JPEG, WebP or GIF images')
        if (p.brief.referenceAssetIds.length >= 8) throw refuse('invalid', 'Up to eight reference images')
        const data = await readBody(req, 15_000_000)
        const id = newId('ref')
        const fileUrl = writeFile(p.id, `${id}.${IMAGE_EXT[mime]}`, data)
        p.assets.push({ id, itemId: '', jobId: '', origin: 'reference', kind: 'image', url: fileUrl, mime, bytes: data.length, status: 'approved', preferred: false, dryRun: false, prompt: '', modelId: '', createdAt: now() })
        p.brief.referenceAssetIds.push(id)
        save(p)
        return done()
      }
      if (method === 'DELETE' && b) {
        p.brief.referenceAssetIds = p.brief.referenceAssetIds.filter((id) => id !== b)
        p.assets = p.assets.filter((x) => !(x.id === b && x.origin === 'reference'))
        save(p)
        return done()
      }
    }

    if (a === 'concepts' && method === 'POST') {
      const body = await readJson<{ feedback?: string }>(req)
      proposeConcepts(p, text(body.feedback)?.trim() || undefined)
      return done()
    }

    if (a === 'direction') {
      if (method === 'POST') {
        const body = await readJson<{ conceptIds?: string[]; note?: string }>(req)
        chooseDirection(p, Array.isArray(body.conceptIds) ? body.conceptIds : [], text(body.note))
        return done()
      }
      if (method === 'PUT') {
        const body = await readJson<Partial<Concept>>(req)
        if (!p.direction) throw refuse('invalid', 'There is no direction to edit yet')
        for (const key of ['name', 'idea', 'visualLanguage', 'artDirection', 'cinematography', 'message', 'productionApproach'] as const) {
          const v = text(body[key])
          if (v !== undefined) p.direction[key] = v
        }
        if (Array.isArray(body.deliverables)) p.direction.deliverables = body.deliverables.filter((x) => typeof x === 'string').slice(0, 20)
        if (Array.isArray(body.palette)) p.direction.palette = body.palette.filter((s) => s && typeof s.name === 'string' && /^#[0-9a-f]{6}$/i.test(s.hex)).slice(0, 6)
        save(p)
        return done()
      }
    }

    if (a === 'plan') {
      if (method === 'POST' && !b) {
        const body = await readJson<{ note?: string }>(req)
        buildPlan(p, text(body.note))
        return done()
      }
      if (!p.plan) throw refuse('invalid', 'There is no production plan yet')
      if (b === 'items' && method === 'POST' && !c) {
        const body = await readJson<Partial<PlanItem>>(req)
        const kind = body.kind === 'video' ? 'video' : 'image'
        const modelId = DEFAULT_MODEL[p.mode][kind]
        const item: PlanItem = { id: newId('itm'), title: kind === 'video' ? 'New film shot' : 'New visual', group: kind === 'video' ? 'video_shot' : 'supporting', kind, purpose: '', description: '', prompt: '', modelId, modelReason: `Default ${p.mode} model.`, aspect: '16:9', resolution: getAdapter(modelId)!.resolutions[0], durationSec: kind === 'video' ? 5 : 0, variations: 1, dependsOn: [], useBriefReferences: false }
        p.plan.items.push(item)
        applyItem(p, item, body)
        save(p)
        return done()
      }
      const item = p.plan.items.find((i) => i.id === c)
      if (b === 'items' && c && !item) throw refuse('not_found', 'No such plan item')
      if (b === 'items' && item && method === 'PATCH' && !d) {
        applyItem(p, item, await readJson<Partial<PlanItem>>(req))
        save(p)
        return done()
      }
      if (b === 'items' && item && method === 'DELETE' && !d) {
        if (p.assets.some((x) => x.itemId === item.id && x.status !== 'rejected')) throw refuse('invalid', 'This item has outputs. Reject them first if you really want it gone; approved work is never discarded.')
        if (p.jobs.some((j) => j.itemId === item.id && ACTIVE_JOB.includes(j.status) && j.status !== 'pending')) throw refuse('busy', 'A generation for this item is running. Cancel it first.')
        for (const j of p.jobs) if (j.itemId === item.id && j.status === 'pending') await cancel(p, j.id)
        p.plan.items = p.plan.items.filter((i) => i.id !== item.id)
        for (const i of p.plan.items) i.dependsOn = i.dependsOn.filter((id) => id !== item.id)
        save(p)
        return done()
      }
      if (b === 'items' && item && d === 'revise' && method === 'POST') {
        const body = await readJson<{ note?: string }>(req)
        revisePrompt(p, item.id, text(body.note) ?? '')
        return done()
      }
    }

    if (a === 'quote' && method === 'POST') return send(res, 200, quote(p, await readJson<RunRequest>(req))), true

    if (a === 'run' && method === 'POST') {
      run(p, await readJson<RunRequest>(req))
      return done()
    }

    if (a === 'jobs' && b && c === 'cancel' && method === 'POST') {
      await cancel(p, b)
      return done()
    }

    if (a === 'assets' && b && method === 'PATCH') {
      const body = await readJson<{ status?: Asset['status']; preferred?: boolean }>(req)
      const status = body.status && ['new', 'approved', 'rejected'].includes(body.status) ? body.status : undefined
      patchAsset(p, b, { status, preferred: typeof body.preferred === 'boolean' ? body.preferred : undefined })
      const producible = p.plan?.items.filter((i) => i.group !== 'final_video') ?? []
      if (producible.length && producible.every((i) => p.assets.some((x) => x.itemId === i.id && x.status === 'approved'))) {
        p.stage = 'delivery'
        save(p)
      }
      return done()
    }

    if (a === 'animate' && method === 'POST') {
      const body = await readJson<{ assetId?: string }>(req)
      const asset = p.assets.find((x) => x.id === body.assetId && x.kind === 'image' && x.origin !== 'reference')
      if (!asset || !p.plan) throw refuse('not_found', 'Choose a generated image to animate')
      const source = p.plan.items.find((i) => i.id === asset.itemId)
      const modelId = DEFAULT_MODEL[p.mode].video
      p.plan.items.push({
        id: newId('itm'),
        title: `Film shot from ${source?.title ?? 'image'}`,
        group: 'video_shot',
        kind: 'video',
        purpose: 'A film shot that starts on this exact frame.',
        description: source?.description ?? '',
        prompt: 'Slow, deliberate camera push-in. Subtle natural motion in the scene; the subject, composition and lighting stay exactly as in the first frame.',
        modelId,
        modelReason: `Default ${p.mode} video model. Change it on the card if this shot needs more.`,
        aspect: source?.aspect ?? '16:9',
        resolution: getAdapter(modelId)!.resolutions[0],
        durationSec: 5,
        variations: 1,
        dependsOn: source ? [source.id] : [],
        pinnedAssetId: asset.id,
        useBriefReferences: false,
      })
      save(p)
      return done()
    }

    if (a === 'assemble' && method === 'POST') {
      await assemble(p)
      return done()
    }

    if (a === 'case-study' && method === 'POST') {
      draftCaseStudy(p)
      return done()
    }

    if (a === 'export.zip' && method === 'GET') {
      const data = exportZip(p)
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': data.length, 'content-disposition': `attachment; filename="${slug(p.plan?.campaignTitle ?? p.name)}.zip"`, 'cache-control': 'no-store' })
      res.end(data)
      return true
    }

    throw refuse('not_found', 'No such route')
  } catch (err) {
    const code = (err as { code?: unknown }).code
    const known = typeof code === 'string' && ['budget', 'unknown_cost', 'not_found', 'invalid', 'busy', 'not_configured'].includes(code)
    const status = !known ? 500 : code === 'not_found' ? 404 : code === 'invalid' ? 400 : code === 'not_configured' ? 503 : 409
    if (!known) console.error('  Studio error:', err instanceof Error ? err.message : err)
    if (!res.headersSent) send(res, status, { error: err instanceof Error ? err.message : String(err), code: known ? code : 'internal' })
    return true
  }
}
