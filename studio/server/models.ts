// fal.ai model adapters.
//
// Every endpoint id and input field below was read from fal's live OpenAPI schema
// (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=...) on 2026-11-12.
// Each adapter builds only the fields its own endpoint accepts. Prices are never
// written here: they come from fal's pricing API at runtime (see pricing below).

import type { Estimate, MediaKind, ModelInfo, QualityMode } from '../shared/types.ts'

export interface Spec {
  prompt: string
  aspect: string
  resolution: string
  durationSec: number
  count: number
  /** Public URLs of reference images, most important first. */
  refs: string[]
}

export interface Adapter {
  id: string
  label: string
  kind: MediaKind
  tier: QualityMode
  textEndpoint?: string
  refEndpoint?: string
  aspects: string[]
  resolutions: string[]
  duration?: [number, number]
  maxVariations: number
  maxRefs: number
  strengths: string
  build(spec: Spec): Record<string, unknown>
  /** Megapixels of one output, for models billed per megapixel. */
  megapixels(spec: Spec): number
}

const ALL_ASPECTS = ['16:9', '9:16', '1:1', '4:5', '3:4', '4:3', '21:9']

/** [width, height] at roughly one megapixel, sides divisible by 16. */
const BASE_SIZE: Record<string, [number, number]> = {
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '1:1': [1024, 1024],
  '4:5': [912, 1136],
  '3:4': [880, 1168],
  '4:3': [1168, 880],
  '21:9': [1568, 672],
}

const SIZE_PRESET: Record<string, string> = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
}

const scaleOf = (resolution: string) => (resolution === '4K' ? 4 : resolution === '2K' ? 2 : 1)

function dims(aspect: string, resolution: string): { width: number; height: number } {
  const [w, h] = BASE_SIZE[aspect] ?? BASE_SIZE['1:1']
  const k = scaleOf(resolution)
  return { width: w * k, height: h * k }
}

function megapixels(spec: Spec): number {
  const d = dims(spec.aspect, spec.resolution)
  return (d.width * d.height) / 1_000_000
}

/** image_size: a preset name at base resolution, explicit pixels otherwise. */
function imageSize(spec: Spec): string | { width: number; height: number } {
  if (scaleOf(spec.resolution) === 1 && SIZE_PRESET[spec.aspect]) return SIZE_PRESET[spec.aspect]
  return dims(spec.aspect, spec.resolution)
}

const refs = (spec: Spec, max: number) => spec.refs.slice(0, max)

/** Google's Nano Banana family shares one input shape; only `resolution` support differs. */
function nanoBanana(a: Pick<Adapter, 'id' | 'label' | 'tier' | 'strengths' | 'resolutions'> & { endpoint: string }): Adapter {
  const hasResolution = a.resolutions.length > 1
  return {
    ...a,
    kind: 'image',
    textEndpoint: a.endpoint,
    refEndpoint: `${a.endpoint}/edit`,
    aspects: ALL_ASPECTS,
    maxVariations: 4,
    maxRefs: 6,
    megapixels,
    build: (s) => ({
      prompt: s.prompt,
      num_images: s.count,
      aspect_ratio: s.aspect,
      output_format: 'png',
      ...(hasResolution ? { resolution: s.resolution } : {}),
      ...(s.refs.length ? { image_urls: refs(s, 6) } : {}),
    }),
  }
}

/** Models that take `image_size` (FLUX Klein, Seedream). */
function sized(a: Pick<Adapter, 'id' | 'label' | 'tier' | 'strengths' | 'resolutions' | 'maxVariations'> & { text: string; edit: string; extra?: Record<string, unknown> }): Adapter {
  return {
    id: a.id,
    label: a.label,
    tier: a.tier,
    strengths: a.strengths,
    resolutions: a.resolutions,
    maxVariations: a.maxVariations,
    kind: 'image',
    textEndpoint: a.text,
    refEndpoint: a.edit,
    aspects: ALL_ASPECTS,
    maxRefs: 6,
    megapixels,
    build: (s) => ({
      prompt: s.prompt,
      num_images: s.count,
      image_size: imageSize(s),
      output_format: 'png',
      ...a.extra,
      ...(s.refs.length ? { image_urls: refs(s, 6) } : {}),
    }),
  }
}

function video(a: Pick<Adapter, 'id' | 'label' | 'tier' | 'strengths' | 'resolutions'> & { endpoint: string; duration: [number, number]; build: (s: Spec, image: string) => Record<string, unknown> }): Adapter {
  return {
    id: a.id,
    label: a.label,
    tier: a.tier,
    strengths: a.strengths,
    resolutions: a.resolutions,
    duration: a.duration,
    kind: 'video',
    refEndpoint: a.endpoint,
    aspects: ALL_ASPECTS, // follows the keyframe
    maxVariations: 1,
    maxRefs: 1,
    megapixels: () => 0,
    build: (s) => a.build(s, s.refs[0]),
  }
}

export const ADAPTERS: Adapter[] = [
  // ---------- Images ----------
  sized({
    id: 'flux-3-klein',
    label: 'FLUX.3 Klein',
    tier: 'economy',
    text: 'blackforestlabs/flux-3/klein/text-to-image',
    edit: 'blackforestlabs/flux-3/klein/edit-image',
    resolutions: ['1K'],
    maxVariations: 4,
    strengths: 'Fast, inexpensive FLUX. Composition and lighting exploration, many variations, rough keyframes. Not for final typography.',
  }),
  nanoBanana({
    id: 'nano-banana-lite',
    label: 'Nano Banana Lite',
    tier: 'economy',
    endpoint: 'google/nano-banana-lite',
    resolutions: ['1K'],
    strengths: 'Cheap Google model with good prompt adherence and reference editing. Exploration that must stay close to a reference image.',
  }),
  nanoBanana({
    id: 'nano-banana-2.1',
    label: 'Nano Banana 2.1',
    tier: 'balanced',
    endpoint: 'google/nano-banana-2.1',
    resolutions: ['1K', '2K', '4K'],
    strengths: 'Strong all-rounder: follows detailed art direction, keeps a product or character consistent across reference edits, legible text.',
  }),
  sized({
    id: 'seedream-5.5',
    label: 'Seedream 5.5',
    tier: 'balanced',
    text: 'bytedance/seedream/v5.5/text-to-image',
    edit: 'bytedance/seedream/v5.5/edit',
    resolutions: ['1K', '2K'],
    maxVariations: 4,
    extra: { watermark: false },
    strengths: 'Photoreal fidelity and rich material detail at 2K: product close-ups, automotive surfaces, fashion, realistic environments.',
  }),
  nanoBanana({
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    tier: 'premium',
    endpoint: 'fal-ai/nano-banana-pro',
    resolutions: ['1K', '2K', '4K'],
    strengths: 'Highest-end stills: hero key visuals, precise typography and layout, the most faithful reference consistency. Use for finals.',
  }),

  // ---------- Video (image-to-video: every shot starts from an approved keyframe) ----------
  video({
    id: 'kling-4-flash',
    label: 'Kling 4 Flash',
    tier: 'economy',
    endpoint: 'kling/v4/flash/image-to-video',
    resolutions: ['720p'],
    duration: [3, 15],
    strengths: 'Fast 720p motion tests and animatics from a keyframe.',
    build: (s, image) => ({ prompt: s.prompt, start_image_url: image, duration: s.durationSec, resolution: '720p' }),
  }),
  video({
    id: 'seedance-2-fast',
    label: 'Seedance 2.0 Fast',
    tier: 'balanced',
    endpoint: 'bytedance/seedance-2.0/fast/image-to-video',
    resolutions: ['720p', '480p'],
    duration: [4, 15],
    strengths: 'Reliable camera moves and stable subjects at 720p for a moderate price. Good default for commercial shots.',
    build: (s, image) => ({ prompt: s.prompt, image_url: image, duration: String(s.durationSec), resolution: s.resolution, aspect_ratio: 'auto', generate_audio: false }),
  }),
  video({
    id: 'hailuo-3',
    label: 'Hailuo 3',
    tier: 'balanced',
    endpoint: 'minimax/h3/image-to-video',
    resolutions: ['768P', '480P', '2K'],
    duration: [5, 15],
    strengths: 'Expressive physical motion and characters; a good second opinion when a shot needs energy.',
    build: (s, image) => ({ prompt: s.prompt, image_url: image, duration: s.durationSec, resolution: s.resolution }),
  }),
  video({
    id: 'kling-4',
    label: 'Kling 4',
    tier: 'premium',
    endpoint: 'kling/v4/image-to-video',
    resolutions: ['1080p', '720p'],
    duration: [3, 15],
    strengths: 'Final-quality 1080p cinematic shots with precise, controlled camera work.',
    build: (s, image) => ({ prompt: s.prompt, start_image_url: image, duration: s.durationSec, resolution: s.resolution }),
  }),
  video({
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    tier: 'premium',
    endpoint: 'bytedance/seedance-2.5/us/image-to-video',
    resolutions: ['1080p', '720p', '480p'],
    duration: [4, 15],
    strengths: 'Top-tier 1080p realism and temporal consistency for hero shots.',
    build: (s, image) => ({ prompt: s.prompt, image_url: image, duration: String(s.durationSec), resolution: s.resolution, aspect_ratio: 'auto', generate_audio: false }),
  }),
]

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]))
export const getAdapter = (id: string) => BY_ID.get(id)

/** The model each quality mode falls back to. Claude may choose differently and must say why. */
export const DEFAULT_MODEL: Record<QualityMode, Record<MediaKind, string>> = {
  economy: { image: 'flux-3-klein', video: 'kling-4-flash' },
  balanced: { image: 'nano-banana-2.1', video: 'seedance-2-fast' },
  premium: { image: 'nano-banana-pro', video: 'kling-4' },
}

export function endpointFor(a: Adapter, hasRefs: boolean): string | null {
  if (hasRefs) return a.refEndpoint ?? null
  return a.textEndpoint ?? null
}

/** Clamp a requested spec to what the adapter accepts. Never changes the model. */
export function fit(a: Adapter, s: { aspect: string; resolution: string; durationSec: number; count: number }) {
  const [lo, hi] = a.duration ?? [0, 0]
  return {
    aspect: a.aspects.includes(s.aspect) ? s.aspect : a.aspects[0],
    resolution: a.resolutions.includes(s.resolution) ? s.resolution : a.resolutions[0],
    durationSec: a.kind === 'video' ? Math.min(hi, Math.max(lo, Math.round(s.durationSec) || 5)) : 0,
    count: Math.min(a.maxVariations, Math.max(1, Math.round(s.count) || 1)),
  }
}

/** Validate and build the request for fal. Throws with a readable reason. */
export function buildRequest(a: Adapter, spec: Spec): { endpoint: string; input: Record<string, unknown> } {
  const hasRefs = spec.refs.length > 0
  const endpoint = endpointFor(a, hasRefs)
  if (!endpoint) throw new Error(hasRefs ? `${a.label} cannot take reference images` : `${a.label} needs a reference image`)
  if (!spec.prompt.trim()) throw new Error('The prompt is empty')
  if (!a.aspects.includes(spec.aspect)) throw new Error(`${a.label} does not support aspect ${spec.aspect}`)
  if (!a.resolutions.includes(spec.resolution)) throw new Error(`${a.label} does not support resolution ${spec.resolution}`)
  if (spec.count < 1 || spec.count > a.maxVariations) throw new Error(`${a.label} makes 1 to ${a.maxVariations} outputs per request`)
  if (a.duration && (spec.durationSec < a.duration[0] || spec.durationSec > a.duration[1])) throw new Error(`${a.label} takes ${a.duration[0]} to ${a.duration[1]} seconds`)
  return { endpoint, input: a.build(spec) }
}

// ---------- Pricing (fal platform API) ----------

interface Price {
  unitPrice: number
  unit: string
  currency: string
}

const prices = new Map<string, Price>()
export const pricing = { fetchedAt: null as string | null, error: null as string | null }

interface FalPrice {
  endpoint_id: string
  unit_price: number
  unit: string
  currency: string
}

/** Replace the price table with rows in the shape fal's pricing API returns. */
export function loadPrices(rows: FalPrice[]): void {
  prices.clear()
  for (const p of rows) prices.set(p.endpoint_id, { unitPrice: p.unit_price, unit: p.unit, currency: p.currency })
}

const allEndpoints = () => [...new Set(ADAPTERS.flatMap((a) => [a.textEndpoint, a.refEndpoint].filter((e): e is string => !!e)))]

/** GET https://api.fal.ai/v1/models/pricing: unit price and billing unit per endpoint. Needs FAL_KEY. Free. */
export async function refreshPricing(falKey: string): Promise<void> {
  if (!falKey) {
    pricing.error = 'FAL_KEY is not set, so live prices cannot be read'
    return
  }
  try {
    const url = 'https://api.fal.ai/v1/models/pricing?endpoint_id=' + allEndpoints().map(encodeURIComponent).join(',')
    const res = await fetch(url, { headers: { authorization: `Key ${falKey}` }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`fal pricing API answered ${res.status}`)
    const body = (await res.json()) as { prices?: FalPrice[] }
    loadPrices(body.prices ?? [])
    pricing.fetchedAt = new Date().toISOString()
    pricing.error = null
  } catch (err) {
    pricing.error = err instanceof Error ? err.message : String(err)
  }
}

export const pricingCoverage = () => ({ known: allEndpoints().filter((e) => prices.has(e)).length, total: allEndpoints().length })

const money = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`)

/**
 * Cost of one request, from fal's unit price and billing unit.
 * Units we can turn into a quantity: image, megapixel, second, video, request/generation.
 * Anything else (tokens, GPU time, compute units) is reported as unknown rather than guessed.
 */
export function estimate(a: Adapter, spec: Omit<Spec, 'refs' | 'prompt'>, hasRefs: boolean): Estimate {
  const endpoint = endpointFor(a, hasRefs)
  if (!endpoint) return { usd: null, basis: `${a.label} has no endpoint for this input`, approximate: false }
  const p = prices.get(endpoint)
  if (!p) return { usd: null, basis: pricing.error ?? `fal returned no price for ${endpoint}`, approximate: false }
  if (p.currency !== 'USD') return { usd: null, basis: `Price is in ${p.currency}, not USD`, approximate: false }
  const unit = p.unit.toLowerCase()
  const count = Math.max(1, spec.count)
  let qty: number
  let what: string
  let approximate = false
  if (/megapixel|\bmp\b/.test(unit)) {
    qty = count * Math.max(1, Math.ceil(a.megapixels({ ...spec, prompt: '', refs: [] })))
    what = `${qty} megapixels`
  } else if (/image/.test(unit)) {
    qty = count
    what = `${count} image${count > 1 ? 's' : ''}`
    approximate = scaleOf(spec.resolution) > 1 // higher resolutions are often billed at a multiple
  } else if (/second/.test(unit) && a.kind === 'video') {
    qty = spec.durationSec
    what = `${spec.durationSec} s`
    approximate = a.resolutions.length > 1 // per-second prices can differ by resolution
  } else if (/video|request|generation|call/.test(unit)) {
    qty = count
    what = `${count} ${unit}`
    approximate = a.kind === 'video' // per-video prices are scaled by length and resolution
  } else {
    return { usd: null, basis: `Billed per "${p.unit}" (${money(p.unitPrice)}), which cannot be predicted before running`, approximate: false }
  }
  return { usd: qty * p.unitPrice, basis: `${what} × ${money(p.unitPrice)} / ${p.unit}`, approximate }
}

export function modelInfo(): ModelInfo[] {
  return ADAPTERS.map((a) => {
    const primary = a.textEndpoint ?? a.refEndpoint!
    const p = prices.get(primary)
    return {
      id: a.id,
      label: a.label,
      kind: a.kind,
      tier: a.tier,
      endpoints: [a.textEndpoint, a.refEndpoint].filter((e): e is string => !!e),
      aspects: a.aspects,
      resolutions: a.resolutions,
      duration: a.duration,
      maxVariations: a.maxVariations,
      acceptsReferences: !!a.refEndpoint,
      requiresReference: !a.textEndpoint,
      strengths: a.strengths,
      price: p ? { unitPrice: p.unitPrice, unit: p.unit, currency: p.currency } : null,
    }
  })
}
