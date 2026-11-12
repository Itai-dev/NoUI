// The creative director: Claude turns a brief into concepts, a direction, a production plan,
// prompt revisions and a case-study draft. Planning only. Nothing in this file spends media budget.
//
// Without ANTHROPIC_API_KEY a small built-in "sample director" answers instead, so the rest of
// the workflow can be exercised. Its output is labelled as a sample everywhere it appears.

import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync } from 'node:fs'
import type { Concept, Plan, PlanItem, QualityMode } from '../shared/types.ts'
import { ADAPTERS, DEFAULT_MODEL, fit, getAdapter, modelInfo } from './models.ts'
import { type Stored, filePath, newId, now, save } from './store.ts'

export const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
export const CLAUDE_MODEL = process.env.STUDIO_CLAUDE_MODEL || 'claude-opus-5-5'
const EFFORT = (process.env.STUDIO_CLAUDE_EFFORT || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const client = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null

/** USD per million tokens [input, output], Anthropic list prices. Used only to estimate Claude spend. */
const TOKEN_PRICE: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-fable-5-2': [8, 40],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}

const SYSTEM = `You are the creative director and executive producer of a one-person studio that makes high-end speculative advertising: brand concepts, product films, campaign key visuals and portfolio case studies. Your client is an experienced creative director. Speak to them as a peer: precise, visual, unsentimental.

How you work:
- You think in ideas first, then in pictures. A concept is a strategic point of view on the brand that could only belong to this brief, expressed as a visual world. It is never a list of adjectives.
- You write for production. Every asset you specify has a job in the campaign, and every prompt is a finished shot description: subject, action, setting, composition and framing, lens and camera height, light source and quality, palette, materials and texture, mood. Write prompts as natural descriptive prose, not keyword lists. Name the brand or product in the prompt only where it must appear in the image.
- You protect continuity. The same product is the same product in every frame, the same character keeps their face and wardrobe, and light, palette and environment stay in one world. You achieve this by generating one hero image first and building the other assets from it as a reference, and by repeating the identifying details in every prompt.
- You are careful with money. Stills are cheap and video is expensive, so film shots always start from an approved still (image-to-video) and never from text. You plan the smallest set of assets that delivers the campaign, explore with inexpensive models and reserve premium models for work that will be seen.
- This is speculative work for a portfolio. Never present it as commissioned by a real client, never invent results, awards, metrics or testimonials. If the brief names a real company, treat the work as an unsolicited concept and say so where it matters.`

// ---------- Schemas (structured outputs) ----------

const str = { type: 'string' } as const
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

const conceptSchema = obj({
  name: str,
  idea: str,
  visualLanguage: str,
  artDirection: str,
  cinematography: str,
  palette: { type: 'array', items: obj({ name: str, hex: str }) },
  message: str,
  deliverables: { type: 'array', items: str },
  productionApproach: str,
})

const planSchema = () =>
  obj({
    campaignTitle: str,
    summary: str,
    continuity: str,
    items: {
      type: 'array',
      items: obj({
        key: str,
        title: str,
        group: { type: 'string', enum: ['key_visual', 'social', 'video_shot', 'supporting'] },
        kind: { type: 'string', enum: ['image', 'video'] },
        purpose: str,
        description: str,
        prompt: str,
        modelId: { type: 'string', enum: ADAPTERS.map((a) => a.id) },
        modelReason: str,
        aspect: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5', '3:4', '4:3', '21:9'] },
        resolution: str,
        durationSec: { type: 'integer' },
        variations: { type: 'integer' },
        dependsOn: { type: 'array', items: str },
        useBriefReferences: { type: 'boolean' },
      }),
    },
  })

// ---------- Claude call ----------

type Block = Anthropic.Beta.BetaContentBlockParam

async function ask<T>(p: Stored, task: string, content: Block[], schema: Record<string, unknown>): Promise<T> {
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set')
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 32000,
    // If a safety classifier declines, the API retries on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
  })
  const msg = await stream.finalMessage()
  const [inPrice, outPrice] = TOKEN_PRICE[msg.model] ?? TOKEN_PRICE[CLAUDE_MODEL] ?? [0, 0]
  const inputTokens = msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0)
  p.llm.push({ at: now(), task, model: msg.model, inputTokens, outputTokens: msg.usage.output_tokens, usd: (inputTokens * inPrice + msg.usage.output_tokens * outPrice) / 1e6, sample: false })
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request. Reword the brief and try again.')
  if (msg.stop_reason === 'max_tokens') throw new Error('The reply was cut off before it finished. Try again, or ask for fewer deliverables.')
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return JSON.parse(text) as T
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.'
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached. Wait a moment and ask again.'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API.'
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

// ---------- Prompt building ----------

function briefText(p: Stored): string {
  const b = p.brief
  const rows: [string, string | undefined][] = [
    ['Brand', b.brand],
    ['Product or service', b.product],
    ['Audience', b.audience],
    ['Objective', b.objective],
    ['Deliverables wanted', b.deliverables],
    ['Preferred aesthetic', b.aesthetic],
    ['Aspect ratios', b.aspects?.join(', ')],
    ['Maximum media budget', p.maxBudgetUsd != null ? `$${p.maxBudgetUsd}` : undefined],
  ]
  return `<brief>\n${b.text.trim()}\n${rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n</brief>`
}

/** The brief's uploaded reference images, for Claude to look at (first four). */
function referenceBlocks(p: Stored): Block[] {
  const blocks: Block[] = []
  for (const id of p.brief.referenceAssetIds.slice(0, 4)) {
    const a = p.assets.find((x) => x.id === id)
    if (!a || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mime)) continue
    const file = filePath(p.id, a.url)
    if (!existsSync(file)) continue
    blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: readFileSync(file).toString('base64') } })
  }
  if (blocks.length) blocks.push({ type: 'text', text: 'The images above are the visual references and brand assets supplied with the brief.' })
  return blocks
}

const conceptText = (c: Concept) =>
  JSON.stringify({ name: c.name, idea: c.idea, visualLanguage: c.visualLanguage, artDirection: c.artDirection, cinematography: c.cinematography, palette: c.palette, message: c.message, deliverables: c.deliverables, productionApproach: c.productionApproach }, null, 1)

const toConcept = (c: Omit<Concept, 'id' | 'round'>, round: number): Concept => ({
  ...c,
  id: newId('con'),
  round,
  palette: (c.palette ?? []).filter((s) => /^#[0-9a-f]{6}$/i.test(s.hex)).slice(0, 6),
})

function say(p: Stored, role: 'director' | 'system' | 'user', text: string): void {
  p.log.push({ id: newId('log'), at: now(), role, text })
}

/** Run a director task in the background: set agentTask, do the work, record the outcome. */
function background(p: Stored, task: NonNullable<Stored['agentTask']>, work: () => Promise<void>): void {
  if (p.agentTask) throw Object.assign(new Error('The director is already working on this project'), { code: 'busy' })
  p.agentTask = task
  p.agentError = null
  save(p)
  void work()
    .catch((err) => {
      p.agentError = describeError(err)
    })
    .finally(() => {
      p.agentTask = null
      save(p)
    })
}

// ---------- Tasks ----------

export function proposeConcepts(p: Stored, feedback?: string): void {
  const round = Math.max(0, ...p.concepts.map((c) => c.round)) + 1
  if (feedback) say(p, 'user', feedback)
  background(p, 'concepts', async () => {
    let concepts: Omit<Concept, 'id' | 'round'>[]
    if (client) {
      const earlier = p.concepts.length ? `\n\nDirections already proposed. Do not repeat or lightly vary these; go somewhere else:\n${p.concepts.map((c) => `- ${c.name}: ${c.idea}`).join('\n')}` : ''
      const out = await ask<{ concepts: Omit<Concept, 'id' | 'round'>[]; note: string }>(
        p,
        'concepts',
        [
          ...referenceBlocks(p),
          {
            type: 'text',
            text: `${briefText(p)}${earlier}${feedback ? `\n\nThe creative director's feedback on the previous round:\n${feedback}` : ''}

Propose exactly three creative directions for this campaign. They must be three different strategic ideas, each leading to a visibly different campaign: different insight, different visual world, different way of filming it. A reader should be able to tell them apart from the palette and one sentence.

For each direction:
- name: the campaign line or territory name, a few words.
- idea: the core creative idea in two or three sentences. What is the point of view, and why does it fit this brand.
- visualLanguage: what the work looks like as a system: composition, recurring motifs, typography feeling, how the product is shown.
- artDirection: sets, locations, styling, materials, casting, props.
- cinematography: lens choices, camera movement, light sources and quality, grade.
- palette: four or five colours as name and six-digit hex.
- message: the key campaign message in one line.
- deliverables: the assets this direction would be made of, matched to what the brief asks for.
- productionApproach: how to produce it with generative image and video models: what to lock first, what to build from the hero frame, where the risk is and how to keep cost down.

In "note", write two or three sentences to the creative director introducing the three directions and how they differ. No images or videos are generated at this stage.`,
          },
        ],
        obj({ note: str, concepts: { type: 'array', items: conceptSchema } }),
      )
      concepts = out.concepts.slice(0, 3)
      say(p, 'director', out.note)
    } else {
      concepts = sampleConcepts(p)
      p.llm.push({ at: now(), task: 'concepts', model: 'sample-director', inputTokens: 0, outputTokens: 0, usd: 0, sample: true })
      say(p, 'system', 'Sample director: ANTHROPIC_API_KEY is not set, so these three directions are generic placeholders built from your brief, not Claude\'s work.')
    }
    p.concepts.push(...concepts.map((c) => toConcept(c, round)))
    p.stage = 'concepts'
  })
}

export function chooseDirection(p: Stored, conceptIds: string[], note?: string): void {
  const chosen = conceptIds.map((id) => p.concepts.find((c) => c.id === id)).filter((c): c is Concept => !!c)
  if (!chosen.length) throw Object.assign(new Error('Choose at least one direction'), { code: 'invalid' })
  const approve = (c: Concept) => {
    p.direction = c
    p.stage = p.plan ? p.stage : 'plan'
    say(p, 'system', `Direction approved: ${c.name}.`)
  }
  if (chosen.length === 1 && !note?.trim()) {
    approve({ ...chosen[0] })
    save(p)
    return
  }
  say(p, 'user', `${chosen.length > 1 ? `Combine ${chosen.map((c) => `“${c.name}”`).join(' and ')}` : `Refine “${chosen[0].name}”`}${note?.trim() ? `: ${note.trim()}` : '.'}`)
  background(p, 'direction', async () => {
    if (!client) {
      const [a, ...rest] = chosen
      approve({ ...a, id: newId('con'), name: rest.length ? `${a.name} × ${rest.map((c) => c.name).join(' × ')}` : a.name, idea: [a.idea, ...rest.map((c) => c.idea), note?.trim() ? `Note: ${note.trim()}` : ''].filter(Boolean).join(' ') })
      p.llm.push({ at: now(), task: 'direction', model: 'sample-director', inputTokens: 0, outputTokens: 0, usd: 0, sample: true })
      say(p, 'system', 'Sample director: the selected directions were joined as text. Add ANTHROPIC_API_KEY for a real synthesis.')
      return
    }
    const out = await ask<{ note: string; direction: Omit<Concept, 'id' | 'round'> }>(
      p,
      'direction',
      [
        {
          type: 'text',
          text: `${briefText(p)}

${chosen.length > 1 ? 'The creative director wants these directions combined into one' : 'The creative director chose this direction and wants it refined'}:
${chosen.map(conceptText).join('\n\n')}
${note?.trim() ? `\nTheir instruction:\n${note.trim()}` : ''}

Write the single resulting direction, complete in every field. ${chosen.length > 1 ? 'Find the idea that genuinely joins them; do not staple two campaigns together. If they pull in different directions, pick the stronger spine and borrow from the other.' : 'Change what the instruction asks for and keep the rest of the direction intact.'} In "note", tell the creative director in one or two sentences what you changed and why.`,
        },
      ],
      obj({ note: str, direction: conceptSchema }),
    )
    approve(toConcept(out.direction, Math.max(1, ...chosen.map((c) => c.round))))
    say(p, 'director', out.note)
  })
}

function catalogue(): string {
  return JSON.stringify(
    modelInfo().map((m) => ({
      id: m.id,
      kind: m.kind,
      tier: m.tier,
      strengths: m.strengths,
      resolutions: m.resolutions,
      ...(m.duration ? { durationSecondsRange: m.duration } : {}),
      maxVariations: m.maxVariations,
      price: m.price ? `$${m.price.unitPrice} per ${m.price.unit}` : 'unknown',
    })),
    null,
    1,
  )
}

const MODE_BRIEF: Record<QualityMode, string> = {
  economy: 'Economy: minimise cost. This is exploration. Use economy-tier models for everything unless an asset cannot work without a better one, keep resolutions at their lowest and film shots short.',
  balanced: 'Balanced: weigh quality against cost. Balanced-tier models by default; a premium model only for the hero visual or a shot that carries the film; economy where the asset is supporting.',
  premium: 'Premium: final production quality. Premium-tier models for hero and film work at high resolution; balanced models are still right for supporting assets where the difference would not be seen.',
}

export function buildPlan(p: Stored, note?: string): void {
  if (!p.direction) throw Object.assign(new Error('Approve a direction first'), { code: 'invalid' })
  if (p.jobs.some((j) => !['failed', 'cancelled'].includes(j.status))) throw Object.assign(new Error('Production has started. Edit items on the board instead of re-planning, so approved work keeps its place.'), { code: 'invalid' })
  if (note?.trim()) say(p, 'user', `Re-plan: ${note.trim()}`)
  const direction = p.direction
  background(p, 'plan', async () => {
    let raw: RawPlan
    if (client) {
      raw = await ask<RawPlan>(
        p,
        'plan',
        [
          {
            type: 'text',
            text: `${briefText(p)}

The approved creative direction:
${conceptText(direction)}
${p.plan && note?.trim() ? `\nThe current plan, which the creative director wants changed:\n${JSON.stringify(p.plan.items.map((i) => ({ title: i.title, group: i.group, kind: i.kind, modelId: i.modelId })), null, 1)}\n\nTheir instruction:\n${note.trim()}` : note?.trim() ? `\nInstruction for the plan:\n${note.trim()}` : ''}

Turn this direction into a production plan: the list of assets to generate, in the order they should be made.

Models you may use (fal.ai). Prices are live where known:
${catalogue()}

Quality mode chosen by the creative director. ${MODE_BRIEF[p.mode]}
${p.maxBudgetUsd != null ? `The whole plan, one generation per item, must fit inside $${p.maxBudgetUsd}. Leave room for a few regenerations.` : 'No budget was stated: plan a tight first pass, not everything the campaign could ever contain.'}
The brief ${p.brief.referenceAssetIds.length ? `came with ${p.brief.referenceAssetIds.length} reference image(s). Set useBriefReferences on items that must match them (a real product or logo, for example).` : 'came with no reference images, so useBriefReferences is false everywhere.'}

Rules for the plan:
- The first item is the hero key visual. It establishes the product, character, world and light. It has no dependencies.
- Every other image that shows the same product, character or world lists the hero's key in dependsOn, so it is generated from the approved hero as a reference. Its prompt still describes the full frame and says what must stay identical.
- Every video item is a single continuous shot of 3 to 10 seconds, generated from one image. dependsOn holds exactly one key, the image item that is its first frame. If a shot needs a frame that no other item provides, add that still as its own image item first. The video prompt describes only what changes over time: camera move, subject action, light change, pace. A film is planned as several such shots to be cut together.
- group: key_visual for hero and campaign visuals, social for platform formats, video_shot for film shots, supporting for product close-ups, website and other assets.
- aspect: what the asset's medium calls for (16:9 film and web hero, 9:16 stories and reels, 4:5 or 1:1 feed). A video takes the aspect of its keyframe.
- variations: how many images to generate per run so there is a choice. Three or four for the hero, one or two for assets built from it. Always 1 for video.
- resolution: one of the chosen model's resolutions. durationSec: seconds for video, 0 for images.
- modelReason: one sentence on why this model for this asset, in terms of the asset's needs and the cost.
- purpose: the asset's job in the campaign, one sentence. description: what we see, for a person reading the board.
- key: a short unique slug, used in dependsOn.
- continuity: three or four sentences fixing what must not drift across the campaign: the product's defining features, the character, the palette, the light. Every prompt must be consistent with it.
- campaignTitle and summary: the campaign line and two sentences on how the pieces work together.
Between 5 and 12 items. Fewer, stronger assets beat a long list.`,
          },
        ],
        planSchema(),
      )
    } else {
      raw = samplePlan(p, direction)
      p.llm.push({ at: now(), task: 'plan', model: 'sample-director', inputTokens: 0, outputTokens: 0, usd: 0, sample: true })
      say(p, 'system', 'Sample director: this plan is a generic template (hero, supporting visuals, social, one film shot), not Claude\'s work. Add ANTHROPIC_API_KEY for a real plan.')
    }
    p.plan = normalisePlan(raw, p.mode)
    p.stage = 'plan'
    p.name = p.name || p.plan.campaignTitle
    say(p, client ? 'director' : 'system', `Production plan ready: “${p.plan.campaignTitle}”, ${p.plan.items.length} assets. Nothing has been generated or charged. Review the board, then approve a budget.`)
  })
}

interface RawItem extends Omit<PlanItem, 'id' | 'pinnedAssetId'> {
  key: string
}
interface RawPlan extends Omit<Plan, 'items'> {
  items: RawItem[]
}

/** Make the plan safe to execute: real model ids, supported settings, valid dependencies. */
function normalisePlan(raw: RawPlan, mode: QualityMode): Plan {
  const ids = new Map<string, string>()
  for (const it of raw.items) if (!ids.has(it.key)) ids.set(it.key, newId('itm'))
  const kindOf = new Map(raw.items.map((it) => [it.key, it.kind]))
  const firstImage = raw.items.find((it) => it.kind === 'image')?.key
  const items: PlanItem[] = []
  const seen = new Set<string>()
  for (const it of raw.items.slice(0, 16)) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    let adapter = getAdapter(it.modelId)
    let reason = it.modelReason
    if (!adapter || adapter.kind !== it.kind) {
      adapter = getAdapter(DEFAULT_MODEL[mode][it.kind])!
      reason = `Default ${mode} model for ${it.kind}s.`
    }
    let deps = [...new Set(it.dependsOn)].filter((k) => k !== it.key && ids.has(k) && kindOf.get(k) === 'image')
    if (it.kind === 'video') {
      deps = deps.slice(0, 1)
      if (!deps.length && firstImage) deps = [firstImage]
      if (!deps.length) continue // a film shot with no keyframe cannot be made
    }
    const f = fit(adapter, { aspect: it.aspect, resolution: it.resolution, durationSec: it.durationSec, count: it.variations })
    items.push({
      id: ids.get(it.key)!,
      title: it.title,
      group: it.kind === 'video' ? 'video_shot' : it.group === 'video_shot' ? 'supporting' : it.group,
      kind: it.kind,
      purpose: it.purpose,
      description: it.description,
      prompt: it.prompt,
      modelId: adapter.id,
      modelReason: reason,
      aspect: f.aspect,
      resolution: f.resolution,
      durationSec: f.durationSec,
      variations: f.count,
      dependsOn: deps.map((k) => ids.get(k)!),
      useBriefReferences: !!it.useBriefReferences,
    })
  }
  return { campaignTitle: raw.campaignTitle, summary: raw.summary, continuity: raw.continuity, items }
}

export function revisePrompt(p: Stored, itemId: string, note: string): void {
  const item = p.plan?.items.find((i) => i.id === itemId)
  if (!item || !p.plan) throw Object.assign(new Error('No such plan item'), { code: 'not_found' })
  if (!note.trim()) throw Object.assign(new Error('Say what should change'), { code: 'invalid' })
  if (!client) throw Object.assign(new Error('Prompt revision needs Claude. Set ANTHROPIC_API_KEY, or edit the prompt by hand.'), { code: 'not_configured' })
  const plan = p.plan
  say(p, 'user', `Revise “${item.title}”: ${note.trim()}`)
  background(p, 'revise', async () => {
    const out = await ask<{ prompt: string; note: string }>(
      p,
      'revise',
      [
        {
          type: 'text',
          text: `Campaign: ${plan.campaignTitle}
Direction: ${p.direction ? conceptText(p.direction) : ''}
Continuity that must hold: ${plan.continuity}

Asset: ${item.title} (${item.kind}, ${item.aspect}${item.kind === 'video' ? `, ${item.durationSec}s, generated from a keyframe image` : ''})
Purpose: ${item.purpose}
Current prompt:
${item.prompt}

The creative director's revision note:
${note.trim()}

Rewrite the prompt so the next generation answers the note. Keep everything the note does not question, keep it consistent with the continuity, and keep it a complete shot description in prose. In "note", say in one sentence what you changed.`,
        },
      ],
      obj({ prompt: str, note: str }),
    )
    item.prompt = out.prompt
    say(p, 'director', `${item.title}: ${out.note}`)
  })
}

export function draftCaseStudy(p: Stored): void {
  if (!p.plan || !p.direction) throw Object.assign(new Error('There is no campaign to write up yet'), { code: 'invalid' })
  const plan = p.plan
  const direction = p.direction
  const made = plan.items.filter((i) => p.assets.some((a) => a.itemId === i.id && a.status === 'approved' && !a.dryRun))
  const list = (made.length ? made : plan.items).map((i) => `- ${i.title} (${i.kind}, ${i.aspect}): ${i.purpose}`).join('\n')
  background(p, 'case-study', async () => {
    if (!client) {
      p.caseStudy = `# ${plan.campaignTitle}\n\n*Speculative concept. Not commissioned client work. Sample text: add ANTHROPIC_API_KEY for a written case study.*\n\n## Brief\n${p.brief.text.trim()}\n\n## Strategic idea\n${direction.idea}\n\n## Art direction\n${direction.artDirection}\n\n${direction.cinematography}\n\n## Deliverables\n${list}\n`
      p.llm.push({ at: now(), task: 'case-study', model: 'sample-director', inputTokens: 0, outputTokens: 0, usd: 0, sample: true })
      return
    }
    const out = await ask<{ markdown: string }>(
      p,
      'case-study',
      [
        {
          type: 'text',
          text: `${briefText(p)}

Approved direction:
${conceptText(direction)}

Campaign: ${plan.campaignTitle}. ${plan.summary}
Deliverables ${made.length ? 'produced and approved' : 'planned'}:
${list}

Write a concise portfolio case-study draft in Markdown, 250 to 400 words, with these sections: a title line, a one-line italic statement that this is a speculative concept (not commissioned, and if the brand is fictional, say so), "The brief", "The challenge", "The idea", "Art direction", "Deliverables". Describe the thinking and the craft. Do not state or imply business results, metrics, client reactions, awards or anything that did not happen. Write it in the first person plural or impersonally, in plain confident prose.`,
        },
      ],
      obj({ markdown: str }),
    )
    p.caseStudy = out.markdown
  })
}

// ---------- Sample director (no API key) ----------

function sampleConcepts(p: Stored): Omit<Concept, 'id' | 'round'>[] {
  const subject = p.brief.brand?.trim() || p.brief.product?.trim() || 'the brand'
  const mk = (name: string, idea: string, look: string, art: string, cine: string, palette: [string, string][], message: string, approach: string) => ({
    name,
    idea,
    visualLanguage: look,
    artDirection: art,
    cinematography: cine,
    palette: palette.map(([n, hex]) => ({ name: n, hex })),
    message,
    deliverables: ['Hero key visual', 'Supporting key visuals', 'Social formats', 'Short film shots'],
    productionApproach: approach,
  })
  return [
    mk('Quiet Monument', `SAMPLE. ${subject} shown as architecture: still, monumental, alone in a vast space.`, 'Centred, symmetrical frames with large negative space.', 'Raw concrete halls, a single shaft of daylight, no people.', 'Locked-off wide lens, slow push-in, soft overcast top light, cool neutral grade.', [['Concrete', '#8a8d8f'], ['Bone', '#e7e2d6'], ['Graphite', '#1d1f21'], ['Signal', '#d6f25a']], 'Presence needs no noise.', 'Lock one hero frame, derive every other frame from it as a reference.'),
    mk('Night Current', `SAMPLE. ${subject} moving through a wet city at night, seen in reflections and passing light.`, 'Off-centre, layered frames through glass and rain; motion blur as a motif.', 'Neon-lit streets after rain, a single driver or wearer glimpsed, never posed.', 'Long lens, handheld drift, practical light sources, high-contrast teal and amber grade.', [['Ink', '#0b1220'], ['Teal', '#1f6f78'], ['Amber', '#f2a33a'], ['Rose', '#d9486e']], 'The city moves around you.', 'Generate the hero at night first, then build reflections and details from it.'),
    mk('Soft Machine', `SAMPLE. ${subject} as something made by hand: warm, tactile, shown in parts and in making.`, 'Macro details and flat-lay compositions on warm paper tones.', 'Workshop tables, tools, fabric and brushed metal, hands at work.', 'Macro lens, shallow focus, warm window light, gentle film grain.', [['Clay', '#c9896a'], ['Linen', '#efe6d8'], ['Olive', '#6b6f4a'], ['Umber', '#3a2a22']], 'Made, not manufactured.', 'Start from a macro hero, then widen out to the full object using it as reference.'),
  ]
}

function samplePlan(p: Stored, d: Concept): RawPlan {
  const m = DEFAULT_MODEL[p.mode]
  const look = `${d.artDirection} ${d.cinematography}`
  const img = (key: string, title: string, group: RawItem['group'], aspect: string, variations: number, dependsOn: string[], framing: string): RawItem => ({
    key,
    title,
    group,
    kind: 'image',
    purpose: `SAMPLE item: ${title.toLowerCase()} for the campaign.`,
    description: framing,
    prompt: `${framing} ${look} ${p.brief.text.trim().slice(0, 240)}`,
    modelId: m.image,
    modelReason: `Default ${p.mode} image model.`,
    aspect,
    resolution: '1K',
    durationSec: 0,
    variations,
    dependsOn,
    useBriefReferences: false,
  })
  return {
    campaignTitle: d.name,
    summary: 'SAMPLE plan: a hero frame, two supporting visuals and a social format built from it, and one film shot.',
    continuity: `${d.visualLanguage} Palette: ${d.palette.map((c) => c.name).join(', ')}.`,
    items: [
      img('hero', 'Hero key visual', 'key_visual', '16:9', 3, [], 'Wide establishing hero frame of the product in its world.'),
      img('detail', 'Product close-up', 'supporting', '4:5', 2, ['hero'], 'Close detail of the same product, same light.'),
      img('alt', 'Second key visual', 'key_visual', '16:9', 2, ['hero'], 'A second angle on the same scene.'),
      img('social', 'Social story', 'social', '9:16', 2, ['hero'], 'Vertical crop of the hero world for stories.'),
      { ...img('shot1', 'Film shot 1: reveal', 'video_shot', '16:9', 1, ['hero'], 'Slow push-in on the hero frame; light shifts gently across the product.'), kind: 'video', modelId: m.video, modelReason: `Default ${p.mode} video model.`, durationSec: 5, resolution: getAdapter(m.video)!.resolutions[0], prompt: 'Slow, steady camera push-in. Light moves gently across the subject. Nothing else changes.' },
    ],
  }
}
