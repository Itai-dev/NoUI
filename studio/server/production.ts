// Paid media execution: quotes, the budget gate, the job scheduler, fal.ai calls.
//
// Rules this file enforces on the server, whatever the UI does:
//   - No job exists without a budget the user approved, and the sum of reserved and
//     spent estimates can never exceed that cap. The check and the reservation happen
//     in one synchronous step, so concurrent requests cannot both squeeze through.
//   - A job whose price is unknown is refused unless the request says acceptUnknownCost.
//   - The model on a job is the model the user saw. Nothing is substituted.
//   - A paid request is submitted to fal at most once per job. Nothing is auto-retried.
//   - Dry-run jobs never touch fal and their output is marked as a placeholder.

import { createFalClient } from '@fal-ai/client'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { Asset, CostSummary, Estimate, ItemCost, Job, PlanItem, Quote, QualityMode, RunRequest } from '../shared/types.ts'
import { ACTIVE_JOB } from '../shared/types.ts'
import { DEFAULT_MODEL, buildRequest, endpointFor, estimate, fit, getAdapter, type Adapter } from './models.ts'
import { type Stored, all, filePath, filesDir, newId, now, save, writeFile } from './store.ts'

export const FAL_KEY = process.env.FAL_KEY || ''
export const MAX_CONCURRENCY = Math.max(1, Number(process.env.STUDIO_MAX_CONCURRENCY) || 3)

type FalClient = Pick<ReturnType<typeof createFalClient>, 'queue' | 'storage'>
let fal: FalClient | null = FAL_KEY ? createFalClient({ credentials: FAL_KEY }) : null
/** Tests swap in a fake client so the live path can be exercised without fal. */
export function useFalClient(client: unknown): void {
  fal = client as FalClient
}

export class Refusal extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const MODES: QualityMode[] = ['economy', 'balanced', 'premium']
const IN_FLIGHT: Job['status'][] = ['submitting', 'queued', 'running', 'saving']
const isActive = (j: Job) => ACTIVE_JOB.includes(j.status)

// ---------- Costs ----------

function itemHasRefs(p: Stored, item: PlanItem): boolean {
  return item.kind === 'video' || item.dependsOn.length > 0 || !!item.pinnedAssetId || (item.useBriefReferences && p.brief.referenceAssetIds.length > 0)
}

function itemEstimate(p: Stored, item: PlanItem, modelId = item.modelId): Estimate {
  const a = getAdapter(modelId)
  if (!a || a.kind !== item.kind) return { usd: null, basis: `Unknown model "${modelId}"`, approximate: false }
  const f = fit(a, { aspect: item.aspect, resolution: modelId === item.modelId ? item.resolution : a.resolutions[0], durationSec: item.durationSec, count: item.variations })
  return estimate(a, f, itemHasRefs(p, item))
}

/** What a job counts for against the budget. Dry runs cost nothing. */
function jobCharge(j: Job): number {
  if (j.dryRun) return 0
  if (j.status === 'failed') return 0
  // A job cancelled after fal started it may still be billed, so it keeps its reservation.
  if (j.status === 'cancelled' && !j.startedAt) return 0
  return j.actualUsd ?? j.estimate.usd ?? 0
}

export function committed(p: Stored): number {
  return p.jobs.reduce((sum, j) => sum + jobCharge(j), 0)
}

export function costs(p: Stored): CostSummary {
  const items: ItemCost[] = (p.plan?.items ?? []).map((item) => ({
    itemId: item.id,
    estimate: itemEstimate(p, item),
    alternatives: Object.fromEntries(
      MODES.map((m) => {
        const modelId = DEFAULT_MODEL[m][item.kind]
        return [m, { modelId, estimate: itemEstimate(p, item, modelId) }]
      }),
    ) as ItemCost['alternatives'],
  }))
  const planByMode = Object.fromEntries(
    MODES.map((m) => [
      m,
      {
        usd: items.reduce((s, i) => s + (i.alternatives[m].estimate.usd ?? 0), 0),
        unknownItems: items.filter((i) => i.alternatives[m].estimate.usd === null).length,
      },
    ]),
  ) as CostSummary['planByMode']

  let reservedUsd = 0
  let spentUsd = 0
  let actualUsd = 0
  let imageUsd = 0
  let videoUsd = 0
  let unknownJobs = 0
  for (const j of p.jobs) {
    const charge = jobCharge(j)
    if (!j.dryRun && j.status !== 'failed' && j.estimate.usd === null && j.actualUsd === undefined && !(j.status === 'cancelled' && !j.startedAt)) unknownJobs++
    if (isActive(j)) reservedUsd += charge
    else {
      spentUsd += charge
      if (j.actualUsd !== undefined && !j.dryRun) actualUsd += j.actualUsd
    }
    if (j.kind === 'image') imageUsd += charge
    else videoUsd += charge
  }
  return {
    budgetUsd: p.approvedBudgetUsd,
    committedUsd: reservedUsd + spentUsd,
    reservedUsd,
    spentUsd,
    actualUsd,
    imageUsd,
    videoUsd,
    otherUsd: 0,
    llmUsd: p.llm.reduce((s, c) => s + c.usd, 0),
    llmCalls: p.llm.filter((c) => !c.sample).length,
    unknownJobs,
    planUsd: items.reduce((s, i) => s + (i.estimate.usd ?? 0), 0),
    planUnknownItems: items.filter((i) => i.estimate.usd === null).length,
    planByMode,
    items,
  }
}

// ---------- Quote and run ----------

interface Draft {
  item: PlanItem
  adapter: Adapter
  prompt: string
  count: number
  aspect: string
  resolution: string
  durationSec: number
  refAssetIds: string[]
  waitForItemIds: string[]
  estimate: Estimate
}

function draft(p: Stored, req: RunRequest): { drafts: Draft[]; problems: string[] } {
  const problems: string[] = []
  const drafts: Draft[] = []
  if (!p.plan) return { drafts, problems: ['There is no production plan yet'] }
  if (!req.lines?.length) problems.push('Nothing is selected')
  const seen = new Set<string>()
  for (const line of req.lines ?? []) {
    const item = p.plan.items.find((i) => i.id === line.itemId)
    if (!item) {
      problems.push(`Unknown plan item ${line.itemId}`)
      continue
    }
    const name = `“${item.title}”`
    if (seen.has(item.id)) {
      problems.push(`${name} is listed twice`)
      continue
    }
    seen.add(item.id)
    if (item.group === 'final_video') {
      problems.push(`${name} is assembled from shots, not generated`)
      continue
    }
    const adapter = getAdapter(item.modelId)
    if (!adapter || adapter.kind !== item.kind) {
      problems.push(`${name} has no valid model`)
      continue
    }
    if (p.jobs.some((j) => j.itemId === item.id && isActive(j))) {
      problems.push(`${name} already has a generation in progress`)
      continue
    }
    const prompt = (line.prompt ?? item.prompt).trim()
    if (!prompt) problems.push(`${name} has an empty prompt`)

    const refAssetIds: string[] = []
    let waitForItemIds: string[] = []
    const source = line.fromAssetId ?? item.pinnedAssetId
    if (source) {
      const asset = p.assets.find((a) => a.id === source)
      if (!asset || asset.kind !== 'image') problems.push(`${name}: the source image no longer exists`)
      else if (asset.dryRun && p.live) problems.push(`${name}: its source image is a dry-run placeholder, which cannot feed a live generation`)
      else refAssetIds.push(source)
    } else {
      waitForItemIds = item.dependsOn.filter((id) => p.plan!.items.some((i) => i.id === id))
    }
    if (item.kind === 'video' && !refAssetIds.length && !waitForItemIds.length) problems.push(`${name} is a video shot and needs a keyframe image to start from`)
    if (item.useBriefReferences) refAssetIds.push(...p.brief.referenceAssetIds)

    const f = fit(adapter, { aspect: item.aspect, resolution: item.resolution, durationSec: item.durationSec, count: line.count ?? item.variations })
    const hasRefs = refAssetIds.length > 0 || waitForItemIds.length > 0
    if (!endpointFor(adapter, hasRefs)) problems.push(`${name}: ${adapter.label} ${hasRefs ? 'cannot take reference images' : 'needs a reference image'}`)
    drafts.push({ item, adapter, prompt, ...f, refAssetIds, waitForItemIds, estimate: estimate(adapter, f, hasRefs) })
  }
  return { drafts, problems }
}

export function quote(p: Stored, req: RunRequest): Quote {
  const { drafts, problems } = draft(p, req)
  const totalUsd = drafts.reduce((s, d) => s + (d.estimate.usd ?? 0), 0)
  const unknownLines = drafts.filter((d) => d.estimate.usd === null).length
  const committedUsd = committed(p)
  const budgetUsd = req.budgetUsd ?? p.approvedBudgetUsd
  const afterUsd = committedUsd + (p.live ? totalUsd : 0)

  if (p.live && !fal) problems.push('FAL_KEY is not set on the server, so live generation is not possible')
  if (budgetUsd == null || !(budgetUsd > 0)) problems.push('Approve a budget before producing')
  else if ((p.live ? afterUsd : totalUsd) > budgetUsd + 1e-9) problems.push(`This would bring the campaign to $${afterUsd.toFixed(2)}, over the $${budgetUsd.toFixed(2)} budget`)
  if (budgetUsd != null && budgetUsd < committedUsd - 1e-9) problems.push(`The budget cannot be lower than the $${committedUsd.toFixed(2)} already committed`)
  if (unknownLines && !req.acceptUnknownCost) problems.push(`${unknownLines} ${unknownLines === 1 ? 'job has' : 'jobs have'} no known price and need explicit approval`)

  return {
    lines: drafts.map((d) => ({ itemId: d.item.id, title: d.item.title, modelId: d.adapter.id, count: d.count, estimate: d.estimate })),
    totalUsd,
    unknownLines,
    committedUsd,
    budgetUsd: budgetUsd ?? null,
    afterUsd,
    live: p.live,
    problems,
  }
}

/** The budget gate. Synchronous from check to reservation. */
export function run(p: Stored, req: RunRequest): void {
  if (!req.idempotencyKey) throw new Refusal('invalid', 'idempotencyKey is required')
  if (p.idem.includes(req.idempotencyKey)) return // the same click, delivered twice
  const q = quote(p, req)
  if (q.problems.length) {
    const code = q.problems.some((m) => /budget/i.test(m)) ? 'budget' : q.problems.some((m) => /no known price/.test(m)) ? 'unknown_cost' : 'invalid'
    throw new Refusal(code, q.problems.join('. '))
  }
  const { drafts } = draft(p, req)
  p.approvedBudgetUsd = q.budgetUsd
  for (const d of drafts) {
    if (req.lines.find((l) => l.itemId === d.item.id)?.prompt) d.item.prompt = d.prompt
    p.jobs.push({
      id: newId('job'),
      itemId: d.item.id,
      kind: d.item.kind,
      modelId: d.adapter.id,
      endpoint: endpointFor(d.adapter, d.refAssetIds.length > 0 || d.waitForItemIds.length > 0)!,
      prompt: d.prompt,
      aspect: d.aspect,
      resolution: d.resolution,
      durationSec: d.durationSec,
      count: d.count,
      refAssetIds: d.refAssetIds,
      waitForItemIds: d.waitForItemIds,
      status: 'pending',
      estimate: d.estimate,
      dryRun: !p.live,
      createdAt: now(),
    })
  }
  p.idem = [...p.idem.slice(-50), req.idempotencyKey]
  if (p.stage !== 'delivery') p.stage = 'production'
  p.log.push({ id: newId('log'), at: now(), role: 'system', text: `${p.live ? 'Live production' : 'Dry run'} approved: ${drafts.length} ${drafts.length === 1 ? 'generation' : 'generations'}, estimated $${q.totalUsd.toFixed(2)}${q.unknownLines ? ` plus ${q.unknownLines} of unknown cost` : ''}, budget $${q.budgetUsd!.toFixed(2)}.` })
  save(p)
  tick()
}

// ---------- Assets ----------

/** The output of an item that dependents should build on: preferred, else the newest approved. */
function approvedOutput(p: Stored, itemId: string, live: boolean): Asset | undefined {
  const ok = p.assets.filter((a) => a.itemId === itemId && a.status === 'approved' && a.kind === 'image' && (!live || !a.dryRun))
  return ok.find((a) => a.preferred) ?? ok[ok.length - 1]
}

export function patchAsset(p: Stored, assetId: string, patch: { status?: Asset['status']; preferred?: boolean }): void {
  const asset = p.assets.find((a) => a.id === assetId)
  if (!asset) throw new Refusal('not_found', 'No such asset')
  if (patch.status) asset.status = patch.status
  if (patch.preferred !== undefined) {
    if (patch.preferred) {
      for (const a of p.assets) if (a.itemId === asset.itemId) a.preferred = false
      if (asset.status !== 'rejected') asset.status = 'approved' // marking a favourite approves it
    }
    asset.preferred = patch.preferred
  }
  if (asset.status === 'rejected') asset.preferred = false
  // The first approved output of an item becomes its preferred one.
  if (asset.status === 'approved' && asset.itemId && !p.assets.some((a) => a.itemId === asset.itemId && a.preferred)) asset.preferred = true
  save(p)
  tick()
}

// ---------- Scheduler ----------

const working = new Set<string>() // job ids with an async step in progress
const pollFailures = new Map<string, number>()

function fail(p: Stored, job: Job, message: string): void {
  job.status = 'failed'
  job.error = message
  job.waiting = undefined
  job.finishedAt = now()
  save(p)
}

/** fal.ai errors carry the useful text in the response body, not the message. */
function falMessage(err: unknown): string {
  const e = err as { body?: { detail?: unknown }; message?: string; status?: number }
  const d = e?.body?.detail
  let text = ''
  if (typeof d === 'string') text = d
  else if (Array.isArray(d)) text = d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join('; ')
  if (!text) text = e?.message || String(err)
  if (/exhausted balance|locked/i.test(text)) return 'fal.ai balance is empty. Top up at fal.ai/dashboard/billing, then run this again.'
  if (e?.status === 401 || e?.status === 403) return `fal.ai refused the request (${e.status}). Check FAL_KEY and the account balance. ${text}`
  return text
}

/** Called on a timer and after every change. Cheap and synchronous; async work is handed off. */
export function tick(): void {
  const inFlight = () => all().reduce((n, p) => n + p.jobs.filter((j) => IN_FLIGHT.includes(j.status)).length, 0)
  for (const p of all()) {
    let dirty = false
    for (const job of p.jobs) {
      if (job.status === 'pending') {
        let waiting: string | undefined
        const item = p.plan?.items.find((i) => i.id === job.itemId)
        if (!item) {
          job.status = 'cancelled'
          job.finishedAt = now()
          job.waiting = undefined
          dirty = true
          continue
        }
        const missing = job.waitForItemIds.map((id) => p.plan!.items.find((i) => i.id === id)).filter((dep) => dep && !approvedOutput(p, dep.id, !job.dryRun))
        if (p.paused) waiting = 'Paused'
        else if (missing.length) waiting = `Waiting for an approved output of “${missing[0]!.title}”`
        else if (inFlight() >= MAX_CONCURRENCY) waiting = 'Waiting for a free slot'
        if (waiting) {
          if (job.waiting !== waiting) {
            job.waiting = waiting
            dirty = true
          }
          continue
        }
        job.status = 'submitting'
        job.waiting = undefined
        job.startedAt = now()
        save(p)
        dirty = false
        void start(p, job)
      } else if ((job.status === 'queued' || job.status === 'running') && !job.dryRun) {
        void poll(p, job)
      }
    }
    if (dirty) save(p)
  }
}

async function start(p: Stored, job: Job): Promise<void> {
  if (working.has(job.id)) return
  working.add(job.id)
  try {
    const adapter = getAdapter(job.modelId)
    if (!adapter) return fail(p, job, `Model ${job.modelId} is no longer available`)

    // References: explicit assets first, then the approved output of each dependency.
    const refAssets: Asset[] = []
    for (const id of job.refAssetIds) {
      const a = p.assets.find((x) => x.id === id)
      if (a) refAssets.push(a)
    }
    for (const id of job.waitForItemIds) {
      const a = approvedOutput(p, id, !job.dryRun)
      if (a) refAssets.push(a)
    }
    if (job.kind === 'video' && !refAssets.length) return fail(p, job, 'The keyframe image is gone')

    if (job.dryRun) {
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1600))
      if ((job.status as Job['status']) === 'cancelled') return
      for (let i = 0; i < job.count; i++) {
        const id = newId('ast')
        const url = writeFile(p.id, `${id}.svg`, placeholder(job, i, refAssets.length))
        addAsset(p, job, { id, url, mime: 'image/svg+xml', bytes: 0, parentAssetId: refAssets[0]?.id })
      }
      finish(p, job)
      return
    }

    if (!fal) return fail(p, job, 'FAL_KEY is not set on the server')
    const refs: string[] = []
    for (const a of refAssets) refs.push(await publicUrl(p, a))
    const { endpoint, input } = buildRequest(adapter, { prompt: job.prompt, aspect: job.aspect, resolution: job.resolution, durationSec: job.durationSec, count: job.count, refs })
    if (endpoint !== job.endpoint) return fail(p, job, `Endpoint changed since approval (${job.endpoint} → ${endpoint}). Approve it again.`)
    if ((job.status as Job['status']) === 'cancelled') return
    // The one and only submission for this job.
    const submitted = await fal.queue.submit(endpoint, { input })
    job.falRequestId = submitted.request_id
    if ((job.status as Job['status']) === 'cancelled') {
      save(p)
      await fal.queue.cancel(endpoint, { requestId: submitted.request_id }).catch(() => {})
      return
    }
    job.status = 'queued'
    save(p)
  } catch (err) {
    fail(p, job, falMessage(err))
  } finally {
    working.delete(job.id)
    tick()
  }
}

async function poll(p: Stored, job: Job): Promise<void> {
  if (working.has(job.id) || !fal || !job.falRequestId) return
  working.add(job.id)
  try {
    const status = await fal.queue.status(job.endpoint, { requestId: job.falRequestId, logs: false })
    pollFailures.delete(job.id)
    if ((job.status as Job['status']) === 'cancelled') return
    if (status.status === 'IN_PROGRESS' && job.status !== 'running') {
      job.status = 'running'
      save(p)
    } else if (status.status === 'COMPLETED') {
      job.status = 'saving'
      save(p)
      await collect(p, job)
    }
  } catch (err) {
    const n = (pollFailures.get(job.id) ?? 0) + 1
    pollFailures.set(job.id, n)
    if (n >= 8) fail(p, job, `Lost track of the request on fal (${falMessage(err)}). Request id ${job.falRequestId}: check the fal dashboard before generating again.`)
  } finally {
    working.delete(job.id)
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }

/** Download the result into project storage, so nothing depends on fal's temporary URLs. */
async function collect(p: Stored, job: Job): Promise<void> {
  try {
    const result = await fal!.queue.result(job.endpoint, { requestId: job.falRequestId! })
    const found: { url: string; ct: string }[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (typeof o.url === 'string' && /^https:\/\//.test(o.url)) found.push({ url: o.url, ct: String(o.content_type ?? '') })
        Object.values(o).forEach(walk)
      }
    }
    walk(result.data)
    const wanted = found.filter((f) => f.ct.startsWith(`${job.kind}/`) || (job.kind === 'image' ? /\.(png|jpe?g|webp)(\?|$)/i : /\.(mp4|webm|mov)(\?|$)/i).test(f.url))
    if (!wanted.length) return fail(p, job, 'The model finished but returned no media')
    const parent = job.refAssetIds[0] ?? (job.waitForItemIds[0] ? approvedOutput(p, job.waitForItemIds[0], true)?.id : undefined)
    for (const f of wanted) {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(180_000) })
      if (!res.ok) throw new Error(`Downloading the result failed (${res.status}). It is still on fal as request ${job.falRequestId}.`)
      const mime = (res.headers.get('content-type') || f.ct || '').split(';')[0] || (job.kind === 'image' ? 'image/png' : 'video/mp4')
      const data = Buffer.from(await res.arrayBuffer())
      const id = newId('ast')
      const url = writeFile(p.id, `${id}.${EXT[mime] ?? (job.kind === 'image' ? 'png' : 'mp4')}`, data)
      addAsset(p, job, { id, url, mime, bytes: data.length, parentAssetId: parent })
    }
    finish(p, job)
    for (const delay of [20_000, 120_000, 600_000]) setTimeout(() => void readActualCost(p, job), delay).unref()
  } catch (err) {
    fail(p, job, falMessage(err))
  }
}

function addAsset(p: Stored, job: Job, a: Pick<Asset, 'id' | 'url' | 'mime' | 'bytes' | 'parentAssetId'>): void {
  p.assets.push({ ...a, itemId: job.itemId, jobId: job.id, origin: 'generated', kind: job.kind, status: 'new', preferred: false, dryRun: job.dryRun, prompt: job.prompt, modelId: job.modelId, createdAt: now() })
}

function finish(p: Stored, job: Job): void {
  job.status = 'done'
  job.finishedAt = now()
  if (job.dryRun) job.actualUsd = 0
  save(p)
}

/** fal billing events give the real charge per request. Needs a key with billing read permission; silent otherwise. */
async function readActualCost(p: Stored, job: Job): Promise<void> {
  if (job.actualUsd !== undefined || !job.falRequestId) return
  try {
    const url = `https://api.fal.ai/v1/models/billing-events?request_id=${encodeURIComponent(job.falRequestId)}`
    const res = await fetch(url, { headers: { authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return
    const body = (await res.json()) as { billing_events?: { request_id: string; cost_total?: number }[] }
    const events = (body.billing_events ?? []).filter((e) => e.request_id === job.falRequestId && typeof e.cost_total === 'number')
    if (!events.length) return
    job.actualUsd = events.reduce((s, e) => s + e.cost_total!, 0)
    save(p)
  } catch {
    /* estimates stay in place */
  }
}

/** A URL fal can read for a locally stored asset. Uploads to fal storage once and reuses it for 12 hours. */
const uploading = new Map<string, Promise<string>>()

async function publicUrl(p: Stored, asset: Asset): Promise<string> {
  const cached = p.uploads[asset.id]
  if (cached && Date.now() - cached.at < 12 * 3600_000) return cached.url
  // Two jobs starting together share one upload.
  let pending = uploading.get(asset.id)
  if (!pending) {
    pending = (async () => {
      const blob = new Blob([readFileSync(filePath(p.id, asset.url))], { type: asset.mime })
      const url = await fal!.storage.upload(blob)
      p.uploads[asset.id] = { url, at: Date.now() }
      save(p)
      return url
    })().finally(() => uploading.delete(asset.id))
    uploading.set(asset.id, pending)
  }
  return pending
}

export async function cancel(p: Stored, jobId: string): Promise<void> {
  const job = p.jobs.find((j) => j.id === jobId)
  if (!job) throw new Refusal('not_found', 'No such job')
  if (!isActive(job)) return
  const wasRunning = job.status === 'running' || job.status === 'saving'
  if (!wasRunning) job.startedAt = undefined // never ran: the reservation is released
  job.status = 'cancelled'
  job.waiting = undefined
  job.finishedAt = now()
  if (wasRunning) job.error = 'Cancelled while running. fal may still bill this request, so its estimate stays counted.'
  save(p)
  if (fal && job.falRequestId && !job.dryRun) await fal.queue.cancel(job.endpoint, { requestId: job.falRequestId }).catch(() => {})
  tick()
}

/** After a restart: resume what can be resumed, and never resubmit anything that may already have reached fal. */
export function recover(): void {
  for (const p of all()) {
    let dirty = false
    for (const job of p.jobs) {
      if (job.status === 'submitting') {
        if (job.dryRun) job.status = 'pending'
        else if (job.falRequestId) job.status = 'queued'
        else {
          job.status = 'failed'
          job.error = 'The server stopped while this was being submitted, so it is unknown whether fal received it. Check the fal dashboard before generating it again.'
          job.finishedAt = now()
        }
        dirty = true
      } else if (job.status === 'saving') {
        job.status = 'queued' // poll again; the result is still on fal
        dirty = true
      }
    }
    if (p.agentTask) {
      p.agentTask = null
      p.agentError = 'The server restarted while the director was working. Ask again.'
      dirty = true
    }
    if (dirty) save(p)
  }
}

// ---------- Dry-run placeholder ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function placeholder(job: Job, index: number, refCount: number): string {
  const [aw, ah] = job.aspect.split(':').map(Number)
  const w = 1280
  const h = Math.round((w * (ah || 9)) / (aw || 16))
  const words = job.prompt.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).length > 58) {
      lines.push(line)
      line = word
      if (lines.length === 5) break
    } else line = line ? `${line} ${word}` : word
  }
  if (lines.length < 5 && line) lines.push(line)
  const hue = (index * 47 + job.prompt.length * 7) % 360
  const meta = [job.kind === 'video' ? `VIDEO SHOT · ${job.durationSec}s` : `IMAGE ${index + 1}/${job.count}`, job.modelId, job.aspect, job.resolution, refCount ? `${refCount} reference${refCount > 1 ? 's' : ''}` : ''].filter(Boolean).join('  ·  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 18% 16%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 14% 8%)"/></linearGradient>
<pattern id="s" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="28" fill="rgba(255,255,255,0.022)"/></pattern></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#s)"/>
<rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-dasharray="6 8"/>
<text x="56" y="92" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="600" letter-spacing="5" fill="rgba(255,255,255,0.82)">DRY RUN · PLACEHOLDER · NOT A GENERATION</text>
<text x="56" y="132" font-family="Inter, system-ui, sans-serif" font-size="20" letter-spacing="1.5" fill="rgba(255,255,255,0.5)">${esc(meta)}</text>
${lines.map((l, i) => `<text x="56" y="${h - 56 - (lines.length - 1 - i) * 36}" font-family="Inter, system-ui, sans-serif" font-size="25" fill="rgba(255,255,255,0.62)">${esc(l)}</text>`).join('\n')}
</svg>`
}

// ---------- Film assembly (local ffmpeg, free) ----------

export const hasFfmpeg: Promise<boolean> = new Promise((resolve) => execFile('ffmpeg', ['-version'], (err) => resolve(!err)))

const FRAME: Record<string, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '3:4': [1080, 1440], '4:3': [1440, 1080], '21:9': [2520, 1080] }

/** Join the approved video shots, in plan order, into one silent film. */
export async function assemble(p: Stored): Promise<void> {
  if (!(await hasFfmpeg)) throw new Refusal('not_configured', 'ffmpeg is not installed on this machine')
  const shots: { item: PlanItem; file: string }[] = []
  for (const item of p.plan?.items ?? []) {
    if (item.kind !== 'video' || item.group === 'final_video') continue
    const ok = p.assets.filter((a) => a.itemId === item.id && a.status === 'approved' && a.kind === 'video' && !a.dryRun)
    const pick = ok.find((a) => a.preferred) ?? ok[ok.length - 1]
    if (pick && existsSync(filePath(p.id, pick.url))) shots.push({ item, file: filePath(p.id, pick.url) })
  }
  if (shots.length < 2) throw new Refusal('invalid', 'Approve at least two real video shots to assemble a film')
  const [w, h] = FRAME[shots[0].item.aspect] ?? FRAME['16:9']
  const id = newId('ast')
  const name = `${id}.mp4`
  const out = `${filesDir(p.id)}/${name}`
  const filter = shots.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`).join(';') + `;${shots.map((_, i) => `[v${i}]`).join('')}concat=n=${shots.length}:v=1:a=0[v]`
  await new Promise<void>((resolve, reject) =>
    execFile('ffmpeg', ['-y', ...shots.flatMap((s) => ['-i', s.file]), '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out], { maxBuffer: 1 << 26 }, (err, _o, stderr) =>
      err ? reject(new Error(`ffmpeg failed: ${String(stderr).split('\n').slice(-4).join(' ')}`)) : resolve(),
    ),
  )
  let item = p.plan!.items.find((i) => i.group === 'final_video')
  if (!item) {
    item = { id: newId('itm'), title: 'Assembled film', group: 'final_video', kind: 'video', purpose: 'The approved shots cut together in plan order.', description: 'Silent assembly made locally with ffmpeg. Free; no model involved.', prompt: '', modelId: '', modelReason: '', aspect: shots[0].item.aspect, resolution: `${h}p`, durationSec: 0, variations: 1, dependsOn: shots.map((s) => s.item.id), useBriefReferences: false }
    p.plan!.items.push(item)
  }
  for (const a of p.assets) if (a.itemId === item.id) a.preferred = false
  p.assets.push({ id, itemId: item.id, jobId: '', origin: 'assembled', kind: 'video', url: `/api/studio/files/${p.id}/${name}`, mime: 'video/mp4', bytes: statSync(out).size, status: 'approved', preferred: true, dryRun: false, prompt: `Assembled from: ${shots.map((s) => s.item.title).join(' → ')}`, modelId: 'ffmpeg', createdAt: now() })
  save(p)
}
