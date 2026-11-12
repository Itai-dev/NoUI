// Run with: npm test
// No network, no charges: prices are loaded by hand and jobs are kept paused so nothing is submitted.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { PlanItem, RunRequest } from '../shared/types.ts'

process.env.STUDIO_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'studio-test-'))
process.env.FAL_KEY = 'test-key-never-sent' // makes live mode selectable; every job below stays paused

const { ADAPTERS, buildRequest, estimate, getAdapter, loadPrices } = await import('../server/models.ts')
const { Refusal, cancel, committed, costs, quote, run } = await import('../server/production.ts')
const { save } = await import('../server/store.ts')
type Stored = import('../server/store.ts').Stored

// ---------- Adapters against fal's published input schemas ----------

interface Prop {
  types: string[]
  enum: unknown[] | null
  minimum?: number
  maximum?: number
  maxItems?: number
}
const schemas = (JSON.parse(readFileSync(new URL('./fal-schemas.json', import.meta.url), 'utf8')) as { endpoints: Record<string, { required: string[]; properties: Record<string, Prop> }> }).endpoints

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

test('every adapter builds input that fal\'s schema accepts, for every setting it offers', () => {
  let checked = 0
  for (const a of ADAPTERS) {
    for (const hasRefs of a.kind === 'video' ? [true] : [false, true]) {
      for (const aspect of a.aspects) {
        for (const resolution of a.resolutions) {
          for (const durationSec of a.duration ? [a.duration[0], a.duration[1]] : [0]) {
            for (const count of [1, a.maxVariations]) {
              const { endpoint, input } = buildRequest(a, { prompt: 'a test prompt', aspect, resolution, durationSec, count, refs: hasRefs ? ['https://example.com/a.png'] : [] })
              const schema = schemas[endpoint]
              assert.ok(schema, `${a.id}: no schema snapshot for ${endpoint}`)
              for (const req of schema.required) assert.ok(req in input, `${endpoint}: missing required "${req}"`)
              for (const [key, value] of Object.entries(input)) {
                const prop = schema.properties[key]
                assert.ok(prop, `${endpoint}: unknown field "${key}"`)
                const t = typeOf(value)
                assert.ok(prop.types.includes(t) || (t === 'integer' && prop.types.includes('number')), `${endpoint}.${key}: ${t} not in ${prop.types}`)
                if (prop.enum && typeof value === 'string') assert.ok(prop.enum.includes(value), `${endpoint}.${key}: "${value}" not in ${JSON.stringify(prop.enum)}`)
                if (typeof value === 'number') {
                  if (prop.minimum !== undefined) assert.ok(value >= prop.minimum, `${endpoint}.${key}: ${value} < ${prop.minimum}`)
                  if (prop.maximum !== undefined) assert.ok(value <= prop.maximum, `${endpoint}.${key}: ${value} > ${prop.maximum}`)
                }
                if (Array.isArray(value) && prop.maxItems !== undefined) assert.ok(value.length <= prop.maxItems)
              }
              checked++
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 200)
})

test('buildRequest refuses what a model cannot do', () => {
  const kling = getAdapter('kling-4')!
  assert.throws(() => buildRequest(kling, { prompt: 'x', aspect: '16:9', resolution: '1080p', durationSec: 5, count: 1, refs: [] }), /needs a reference image/)
  assert.throws(() => buildRequest(kling, { prompt: 'x', aspect: '16:9', resolution: '1080p', durationSec: 60, count: 1, refs: ['https://e.com/a.png'] }), /seconds/)
  assert.throws(() => buildRequest(getAdapter('flux-3-klein')!, { prompt: ' ', aspect: '16:9', resolution: '1K', durationSec: 0, count: 1, refs: [] }), /empty/)
})

// ---------- Estimates by billing unit ----------

const price = (endpoint_id: string, unit_price: number, unit: string, currency = 'USD') => ({ endpoint_id, unit_price, unit, currency })

test('estimates follow fal\'s billing unit, and unpredictable units are unknown, not guessed', () => {
  loadPrices([
    price('google/nano-banana-2.1', 0.04, 'image'),
    price('blackforestlabs/flux-3/klein/text-to-image', 0.005, 'megapixel'),
    price('bytedance/seedance-2.0/fast/image-to-video', 0.1, 'second'),
    price('kling/v4/image-to-video', 1.5, 'video'),
    price('bytedance/seedream/v5.5/text-to-image', 0.002, '1k tokens'),
    price('fal-ai/nano-banana-pro', 0.12, 'image', 'EUR'),
  ])
  const base = { aspect: '16:9', resolution: '1K', durationSec: 0, count: 3 }
  assert.equal(estimate(getAdapter('nano-banana-2.1')!, base, false).usd, 0.12)
  assert.equal(estimate(getAdapter('nano-banana-2.1')!, { ...base, resolution: '4K' }, false).approximate, true)
  assert.equal(estimate(getAdapter('nano-banana-2.1')!, base, true).usd, null, 'the edit endpoint has its own price; none loaded')
  assert.equal(estimate(getAdapter('flux-3-klein')!, base, false).usd, 3 * 2 * 0.005, '1344×768 rounds up to 2 MP per image')
  assert.equal(estimate(getAdapter('seedance-2-fast')!, { aspect: '16:9', resolution: '720p', durationSec: 8, count: 1 }, true).usd, 0.8)
  const perVideo = estimate(getAdapter('kling-4')!, { aspect: '16:9', resolution: '1080p', durationSec: 8, count: 1 }, true)
  assert.equal(perVideo.usd, 1.5)
  assert.equal(perVideo.approximate, true)
  assert.equal(estimate(getAdapter('seedream-5.5')!, base, false).usd, null, 'token billing cannot be predicted')
  assert.equal(estimate(getAdapter('nano-banana-pro')!, base, false).usd, null, 'non-USD price')
})

// ---------- The budget gate ----------

function project(items: PlanItem[]): Stored {
  const t = new Date().toISOString()
  const p: Stored = {
    id: `prj_test${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test',
    createdAt: t,
    updatedAt: t,
    stage: 'plan',
    brief: { text: 'test', referenceAssetIds: [] },
    mode: 'balanced',
    maxBudgetUsd: null,
    approvedBudgetUsd: null,
    live: true,
    paused: true, // nothing is ever submitted in these tests
    concepts: [],
    direction: null,
    plan: { campaignTitle: 'T', summary: '', continuity: '', items },
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
  save(p)
  return p
}

const image = (id: string, modelId = 'nano-banana-2.1', variations = 1): PlanItem => ({ id, title: id, group: 'key_visual', kind: 'image', purpose: '', description: '', prompt: 'a prompt', modelId, modelReason: '', aspect: '16:9', resolution: '1K', durationSec: 0, variations, dependsOn: [], useBriefReferences: false })
const req = (itemIds: string[], extra: Partial<RunRequest> = {}): RunRequest => ({ lines: itemIds.map((itemId) => ({ itemId })), idempotencyKey: Math.random().toString(36), ...extra })
const refused = (code: string) => (err: unknown) => err instanceof Refusal && err.code === code

test('budget gate: reservations are counted, the cap holds, and nothing runs without approval', async () => {
  loadPrices([price('google/nano-banana-2.1', 0.5, 'image'), price('bytedance/seedream/v5.5/text-to-image', 0.002, '1k tokens')])
  const p = project([image('a'), image('b'), image('c'), image('d', 'seedream-5.5')])

  assert.throws(() => run(p, req(['a'])), refused('budget'), 'no budget approved yet')
  assert.equal(p.jobs.length, 0)

  assert.throws(() => run(p, req(['a', 'b', 'c'], { budgetUsd: 1.2 })), refused('budget'), '$1.50 does not fit $1.20')
  assert.equal(p.jobs.length, 0, 'a refused request reserves nothing, not even the lines that would fit')
  assert.equal(p.approvedBudgetUsd, null, 'a refused request does not set the budget')

  run(p, req(['a', 'b'], { budgetUsd: 1.2 }))
  assert.equal(p.jobs.length, 2)
  assert.equal(committed(p), 1)
  assert.equal(p.jobs.every((j) => j.status === 'pending' && j.waiting === 'Paused'), true)

  // Two more requests arriving together: each is checked against everything already reserved.
  assert.throws(() => run(p, req(['c'])), refused('budget'), 'the third $0.50 would make $1.50')
  assert.throws(() => run(p, req(['a'])), refused('invalid'), 'an item with a generation in progress is not submitted twice')
  assert.equal(committed(p), 1)

  // The same click delivered twice creates one job.
  const again = req(['c'], { budgetUsd: 2 })
  run(p, again)
  run(p, again)
  assert.equal(p.jobs.length, 3)
  assert.equal(committed(p), 1.5)

  // Unknown price needs explicit acceptance.
  assert.equal(quote(p, req(['d'])).unknownLines, 1)
  assert.throws(() => run(p, req(['d'])), refused('unknown_cost'))
  run(p, req(['d'], { acceptUnknownCost: true }))
  assert.equal(costs(p).unknownJobs, 1)

  // The cap cannot be lowered under what is committed.
  assert.throws(() => run(p, req([], { budgetUsd: 1 })), (e: unknown) => e instanceof Refusal)

  // Cancelling a job that never reached fal releases its reservation.
  await cancel(p, p.jobs[0].id)
  assert.equal(committed(p), 1)
  // A failed job costs nothing; a finished one counts at its actual charge once fal reports it.
  p.jobs[1].status = 'failed'
  assert.equal(committed(p), 0.5)
  p.jobs[2].status = 'done'
  p.jobs[2].actualUsd = 0.62
  assert.equal(committed(p), 0.62)
  assert.equal(costs(p).actualUsd, 0.62)
})

test('dry run reserves no money and its placeholders cannot feed a live job', () => {
  loadPrices([price('google/nano-banana-2.1', 0.5, 'image'), price('google/nano-banana-2.1/edit', 0.5, 'image'), price('bytedance/seedance-2.0/fast/image-to-video', 0.1, 'second')])
  const shot: PlanItem = { ...image('shot', 'seedance-2-fast'), kind: 'video', group: 'video_shot', resolution: '720p', durationSec: 5, dependsOn: ['hero'] }
  const p = project([image('hero'), shot])
  p.live = false
  run(p, req(['hero', 'shot'], { budgetUsd: 5 }))
  assert.equal(p.jobs.length, 2)
  assert.equal(p.jobs.every((j) => j.dryRun), true)
  assert.equal(committed(p), 0)
  assert.equal(p.jobs[1].estimate.usd, 0.5, 'the estimate is still shown')

  // A placeholder pinned as a keyframe is refused once the project is live.
  p.jobs.forEach((j) => (j.status = 'done'))
  p.assets.push({ id: 'ast_dry', itemId: 'hero', jobId: p.jobs[0].id, origin: 'generated', kind: 'image', url: '/x.svg', mime: 'image/svg+xml', bytes: 0, status: 'approved', preferred: true, dryRun: true, prompt: '', modelId: 'nano-banana-2.1', createdAt: '' })
  p.plan!.items[1].pinnedAssetId = 'ast_dry'
  p.live = true
  assert.match(quote(p, req(['shot'])).problems.join(' '), /dry-run placeholder/)
})

test('a video shot without a keyframe is refused', () => {
  const p = project([{ ...image('shot', 'kling-4'), kind: 'video', group: 'video_shot', resolution: '1080p', durationSec: 5 }])
  assert.match(quote(p, req(['shot'], { budgetUsd: 50, acceptUnknownCost: true })).problems.join(' '), /needs a keyframe/)
})

// ---------- The live path, against a fake fal ----------

test('live path: one submission per job, references uploaded, results stored locally, slots respected', async () => {
  const { tick, useFalClient, patchAsset, MAX_CONCURRENCY } = await import('../server/production.ts')
  const { filePath } = await import('../server/store.ts')
  loadPrices([price('google/nano-banana-2.1', 0.5, 'image'), price('google/nano-banana-2.1/edit', 0.5, 'image'), price('bytedance/seedance-2.0/fast/image-to-video', 0.1, 'second')])

  const submitted: { endpoint: string; input: Record<string, unknown> }[] = []
  const state = new Map<string, number>() // request id -> status polls so far
  let uploads = 0
  let peak = 0
  useFalClient({
    queue: {
      submit: async (endpoint: string, { input }: { input: Record<string, unknown> }) => {
        submitted.push({ endpoint, input })
        const request_id = `req_${submitted.length}`
        state.set(request_id, 0)
        peak = Math.max(peak, [...state.values()].filter((n) => n < 2).length)
        return { request_id }
      },
      status: async (_e: string, { requestId }: { requestId: string }) => {
        const n = (state.get(requestId) ?? 0) + 1
        state.set(requestId, n)
        return { status: n >= 2 ? 'COMPLETED' : 'IN_PROGRESS' }
      },
      result: async (endpoint: string) => ({ data: endpoint.includes('video') ? { video: { url: 'https://fake.fal/out.mp4', content_type: 'video/mp4' } } : { images: [{ url: 'https://fake.fal/out.png', content_type: 'image/png' }] } }),
      cancel: async () => {},
    },
    storage: { upload: async () => `https://fake.fal/upload_${++uploads}.png` },
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => (String(url).startsWith('https://fake.fal/') ? new Response(Buffer.from('media-bytes'), { headers: { 'content-type': String(url).endsWith('.mp4') ? 'video/mp4' : 'image/png' } }) : new Response('{}', { status: 404 }))) as typeof fetch

  try {
    const shot: PlanItem = { ...image('shot', 'seedance-2-fast'), kind: 'video', group: 'video_shot', resolution: '720p', durationSec: 5, dependsOn: ['hero'] }
    const p = project([image('hero'), image('b'), image('c'), image('d'), image('e'), { ...image('detail'), dependsOn: ['hero'] }, shot])
    p.paused = false
    run(p, req(['hero', 'b', 'c', 'd', 'e', 'detail', 'shot'], { budgetUsd: 10 }))

    const settle = async (done: () => boolean) => {
      for (let i = 0; i < 200 && !done(); i++) {
        tick()
        await new Promise((r) => setTimeout(r, 5))
      }
      assert.ok(done(), 'jobs did not settle')
    }
    const job = (itemId: string) => p.jobs.find((j) => j.itemId === itemId)!

    await settle(() => ['hero', 'b', 'c', 'd', 'e'].every((id) => job(id).status === 'done'))
    assert.ok(peak <= MAX_CONCURRENCY, `at most ${MAX_CONCURRENCY} requests in flight, saw ${peak}`)
    assert.equal(submitted.length, 5, 'dependents wait for an approved hero')
    assert.match(job('shot').waiting ?? '', /approved output of “hero”/)

    const hero = p.assets.find((a) => a.itemId === 'hero')!
    assert.equal(readFileSync(filePath(p.id, hero.url), 'utf8'), 'media-bytes', 'the result is stored locally, not left on fal')
    assert.equal(hero.status, 'new')
    patchAsset(p, hero.id, { status: 'approved' })
    assert.equal(hero.preferred, true)

    await settle(() => job('detail').status === 'done' && job('shot').status === 'done')
    assert.equal(submitted.length, 7, 'every job was submitted exactly once')
    assert.equal(uploads, 1, 'the hero is uploaded once and reused as reference')
    const detail = submitted.find((s) => s.endpoint === 'google/nano-banana-2.1/edit')!
    assert.deepEqual(detail.input.image_urls, ['https://fake.fal/upload_1.png'])
    const video = submitted.find((s) => s.endpoint === 'bytedance/seedance-2.0/fast/image-to-video')!
    assert.equal(video.input.image_url, 'https://fake.fal/upload_1.png')
    assert.equal(video.input.duration, '5')
    assert.equal(p.assets.find((a) => a.itemId === 'shot')!.mime, 'video/mp4')
    assert.equal(p.assets.find((a) => a.itemId === 'shot')!.parentAssetId, hero.id)
    assert.equal(committed(p), 5 * 0.5 + 0.5 + 0.5)
  } finally {
    globalThis.fetch = realFetch
  }
})
