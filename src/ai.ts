import Anthropic from '@anthropic-ai/sdk'
import { createFalClient } from '@fal-ai/client'
import { getMind, MINDS, teamBrief } from './minds'
import { getModel, MEDIA_LABEL, MODEL_GUIDE, MODELS, NOTE_COLORS } from './models'
import type { CardKind, Item, MediaKind, Turn } from './types'

// ---------- Settings (stored only in this browser) ----------

export interface Settings {
  anthropicKey: string
  falKey: string
  claudeModel: string
  effort: 'low' | 'medium' | 'high'
  speak: boolean // read replies aloud
}

const SETTINGS_KEY = 'atelier.settings.v2'
const DEFAULT_SETTINGS: Settings = { anthropicKey: '', falKey: '', claudeModel: 'claude-opus-5-5', effort: 'medium', speak: true }

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

// ---------- Where the keys live ----------
// Keys can sit on the dev server (.env) behind /api, or be typed into Settings in this browser.

export const server = { anthropic: false, fal: false }

export async function detectServerKeys() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' })
    if (r.ok) Object.assign(server, await r.json())
  } catch {
    /* static hosting: no proxy */
  }
  return server
}

export const hasClaude = (s: Settings) => !!s.anthropicKey || server.anthropic
export const hasFal = (s: Settings) => !!s.falKey || server.fal

const fal = (s: Settings) =>
  s.falKey ? createFalClient({ credentials: s.falKey, suppressLocalCredentialsWarning: true }) : createFalClient({ proxyUrl: '/api/fal' })

const claude = (s: Settings) =>
  s.anthropicKey
    ? new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true })
    : new Anthropic({ apiKey: 'server', baseURL: `${location.origin}/api/anthropic`, dangerouslyAllowBrowser: true })

// ---------- Claude ----------

function toImageBlock(url: string): Anthropic.Beta.BetaImageBlockParam | null {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/)
    if (!m) return null
    return { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } }
  }
  return { type: 'image', source: { type: 'url', url } }
}

async function callClaude(s: Settings, system: string, messages: Anthropic.Beta.BetaMessageParam[], schema: Record<string, unknown>): Promise<string> {
  const res = await claude(s).beta.messages.create({
    model: s.claudeModel,
    max_tokens: 16000,
    // If a safety classifier declines, the server retries on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort: s.effort, format: { type: 'json_schema', schema } },
  })
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rewording it.')
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

// ---------- The agent: one message in, a reply and actions out ----------

export interface Action {
  kind: 'note' | MediaKind
  content: string // note text, or the generation prompt
  model: string // '' for notes
  color: string
  use_selection: boolean // feed the selected images in as references
  after: number // index of an earlier action whose result feeds this one, or -1
  count: number // variations (images only)
  aspect: string
  card: '' | CardKind // notes only: a reference, a direction or a studio member's take
  who: string
  title: string
  sources: string[]
  constraint: string
  mind: string
  link_to: string[] // existing item ids, or "@N" for action N of this reply
}

export interface AgentReply {
  reply: string
  actions: Action[]
  remove: string[] // ids to delete
}

const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions', 'remove'],
  properties: {
    reply: { type: 'string' },
    remove: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'content', 'model', 'color', 'use_selection', 'after', 'count', 'aspect', 'card', 'who', 'title', 'sources', 'constraint', 'mind', 'link_to'],
        properties: {
          kind: { type: 'string', enum: ['note', 'image', 'video', 'audio', 'model3d'] },
          content: { type: 'string' },
          model: { type: 'string', enum: ['', ...MODELS.map((m) => m.id)] },
          color: { type: 'string', enum: ['', ...Object.keys(NOTE_COLORS)] },
          use_selection: { type: 'boolean' },
          after: { type: 'integer' },
          count: { type: 'integer', description: 'Variations, 1 to 4 (images only)' },
          aspect: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
          card: { type: 'string', enum: ['', 'reference', 'direction', 'voice'] },
          who: { type: 'string', description: 'reference: the creator; voice: who speaks; else empty' },
          title: { type: 'string', description: 'reference: the work and year; direction: a short name; else empty' },
          sources: { type: 'array', items: { type: 'string' }, description: 'direction: the creators or works it borrows from' },
          constraint: { type: 'string', description: 'direction: its one deliberate limit' },
          mind: { type: 'string', enum: ['', ...MINDS.map((m) => m.id)] },
          link_to: { type: 'array', items: { type: 'string' }, description: 'Draw a line to these: existing item ids, or "@N" for action N (0-based) of this reply' },
        },
      },
    },
  },
}

function systemPrompt(team: string[]) {
  return `You are Atelier, a creative director who talks with the user and makes things on a shared isometric table. Your job is to get the user to new, bold ideas, not to the first obvious one.
The user speaks or types one line at a time. You answer briefly (spoken-style, 1–3 sentences) and act by adding items to the table.

Items you can add:
- note: a short idea, name, line of copy or plan step (max ~25 words). Several notes for lists and brainstorms. card="" for a plain note.
- reference card (kind note, card "reference"): a credited influence. who = the creator, title = the work and year (or "body of work, 1960s"), content = what to steal from it and why it works (max ~30 words).
- direction card (kind note, card "direction"): a remix concept. title = a short name, sources = the 2+ creators or works it combines, constraint = its one deliberate limit, content = the idea in one or two sentences.
- voice card (kind note, card "voice"): one studio member's take. mind = their id (or "" and who = their name for someone outside the studio), content = their idea in their way of seeing (max ~30 words).
- image, video, audio, model3d: generated media. "content" is a complete standalone prompt. For voiceover audio, content is the exact words to speak.
For every action, fill unused fields with "" or [].
Lines: link_to draws lines on the table, for lineage (a reference to the one it descends from), a direction to its references, a voice to what it reacts to, a sketch to its direction. Use "@N" for an action in this same reply.

Choosing a model is your job. Pick the best one for each item from this guide and say in your reply which you chose and why, in a few words:
${MODEL_GUIDE}
Rules of thumb: quick exploration → fast models and several variations; a final or hero piece → the highest quality; text inside an image → nano-banana; logos/icons → recraft-vector; editing what's selected → nano-banana or flux-kontext with use_selection; a clip that needs sound → veo3-fast; a clip from a selected image → kling-2.5. If the user names a model or a quality level, respect it.

Pipelines: you plan the steps yourself; the user only states the goal. Chain actions with "after" (0-based index of an earlier action whose result feeds this one, or -1). The result of the earlier action is passed as the image input of the later one.
- 3D ("a 3D cat", "make me a model of a chair"): unless a suitable image is selected, first make an image built for 3D reconstruction, then model3d with after pointing at it. The image prompt must describe ONE object, centered, whole object in frame, three-quarter view, plain light-gray studio background, soft even lighting, no shadows cast on the floor, no text, no other objects. Prefer nano-banana or seedream-4 for that image.
- Video of a specific subject or scene: first make a hero frame (image), then a video with after, so the clip matches the picture. Go straight to text-to-video only when the user wants speed, or wants sound in the clip (veo3-fast).
- Storyboards: one image per shot, then one video per shot, each with after pointing at its own frame.
- Editing or restyling something that exists: use_selection=true with nano-banana or flux-kontext, no intermediate step.
- A later step may also depend on a step that itself depends on another (image → video → nothing else; image → model3d). Keep chains short: 2 steps is the norm.
Say the plan in your reply in plain words ("Making a cat image first, then the 3D model from it").

Context: the user's selected items are the subject of words like "this", "it", "these". use_selection=true passes the selected images as references.
"remove" lists ids of items the user asked to delete or replace.
If the user is just talking or asking, reply and return no actions. Keep the table focused: 1–12 actions per turn.

How you think (inspired by Austin Kleon's Steal Like an Artist; never quote the book):
- Nothing is original, and that frees us: every creator remixes their influences. Steal the thinking (a structure, a process, a rhythm, a constraint, a way of seeing), never the surface look.
- Study the lineage: find who the user's heroes learned from, and who those people learned from. The deeper sources are less used and more surprising.
- Copying one source is imitation; combining many distant ones is originality. Prefer sources from different fields, eras and places, and one close to home.
- Credit every source by name on its card.
- Constraints make work bold: give every direction one hard limit.
- Make, don't wait: always end with a small next thing the user can do or see.
- Push past the safe idea: when you offer options, one must break a convention of the category on purpose. Say which one is the bold one.
You know the history of human creativity deeply: cave painters, ancient poets and builders, medieval craftspeople, the Renaissance, the moderns, film, music, games, product and contemporary design, across every culture. Use real, specific works, years and methods. When unsure of a detail, stay general rather than invent it.

Remix (when the user starts a project, says "remix", asks for directions, or brings a brief):
1. Brief. Know what it is, for whom, the medium, and 1–3 creators they love. If something important is missing, ask for it in one short question and add no cards. If they say "you choose", choose.
2. Lineage map and steal list (one turn): 6–10 reference cards: their favorites, then who those learned from, up to three levels back. link_to each to the card it descends from. Each card's content says what to steal and why it works.
3. Directions (next turn, or the same one if the user wants speed): 2–3 direction cards, each combining at least 2 distant references with one constraint, linked to those references. One is the bold one.
4. Originality check, in your reply: any direction that leans on a single source gets fixed with a second, distant source before you show it.
5. Make: when the user picks a direction or says go, sketch it with images linked to the direction. Translate what you borrowed into plain visual words.
Names of living artists never go into a media prompt ("in the style of ..."). Describe the qualities you are borrowing instead. References and voice cards may name anyone.
Voice cards speak through a person's known methods and outlook. Never invent quotes and put them in quotation marks.

The studio:${team.length ? `
The user brought these minds into the room:
${teamBrief(team)}
When you ideate, react to directions or the user asks the team, add one voice card per member (mind = their id), each applying that member's methods to the user's actual project, not a summary of their career. Let them disagree; then, as director, say in your reply what you take from them.` : ' none yet. The user can pick a team in the Studio. If they ask what a creator would do, answer with a voice card (mind "" and who = their name).'}
Studio members the user can pick: ${MINDS.map((m) => m.short).join(', ')}. Anyone else in history can be consulted by name too.`
}

export interface AgentContext {
  board: string
  selectedImages: string[]
  team: string[] // studio member ids
}

export async function converse(s: Settings, history: Turn[], text: string, ctx: AgentContext): Promise<AgentReply> {
  if (!hasClaude(s)) return demoReply(text, ctx)
  // The agent remembers what it put on the table in each earlier reply.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((t) => ({
    role: t.role,
    content: t.steps?.length ? `${t.text}\n(added: ${t.steps.map((s) => `${s.count} ${s.kind}${s.model ? ` via ${s.model}` : ''}`).join(', ')})` : t.text,
  }))
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const url of ctx.selectedImages.slice(0, 4)) {
    const b = toImageBlock(url)
    if (b) content.push(b)
  }
  content.push({ type: 'text', text: `Table:\n${ctx.board}\n\nUser: ${text}` })
  messages.push({ role: 'user', content })
  const out = JSON.parse(await callClaude(s, systemPrompt(ctx.team), messages, REPLY_SCHEMA)) as AgentReply
  out.actions = out.actions.slice(0, 12)
  return out
}

export function summarizeBoard(items: Item[], selected: Set<string>) {
  if (!items.length) return 'empty'
  return items
    .map((it) => {
      const what =
        it.card === 'reference'
          ? `reference: ${it.who} · ${it.title} · "${(it.text ?? '').slice(0, 80)}"`
          : it.card === 'direction'
            ? `direction "${it.title}" from ${(it.sources ?? []).join(' × ')}, constraint: ${it.constraint} · "${(it.text ?? '').slice(0, 80)}"`
            : it.card === 'voice'
              ? `voice of ${getMind(it.mind)?.name ?? it.who}: "${(it.text ?? '').slice(0, 80)}"`
              : it.kind === 'note'
                ? `"${(it.text ?? '').slice(0, 80)}"`
          : `${it.kind}${it.prompt ? ` "${it.prompt.slice(0, 60)}"` : ''}${it.model ? ` via ${it.model}` : ''}${it.status === 'error' ? ' (failed)' : ''}`
      const links = it.links?.length ? ` → ${it.links.join(', ')}` : ''
      return `- ${it.id}: ${what}${links}${selected.has(it.id) ? ' [selected]' : ''}`
    })
    .join('\n')
}

// ---------- fal.ai media ----------

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

const EXT: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|webp|gif)(\?|$)/i,
  video: /\.(mp4|webm|mov)(\?|$)/i,
  audio: /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i,
  model3d: /\.(glb|gltf)(\?|$)/i,
}

function extractMedia(data: unknown, kind: MediaKind): string[] {
  const found: { url: string; ct: string }[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.url === 'string') found.push({ url: o.url, ct: String(o.content_type ?? '') })
      Object.values(o).forEach(walk)
    }
  }
  walk(data)
  const prefix = kind === 'model3d' ? 'model/' : `${kind}/`
  const match = found.filter((f) => f.ct.startsWith(prefix) || EXT[kind].test(f.url))
  return (match.length ? match : found).map((f) => f.url)
}

/** fal.ai errors carry the useful text in the response body, not the message. */
function falMessage(err: unknown): string {
  const e = err as { body?: { detail?: unknown }; message?: string; status?: number }
  const d = e?.body?.detail
  let text = ''
  if (typeof d === 'string') text = d
  else if (Array.isArray(d)) text = d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join('; ')
  if (!text) text = e?.message || String(err)
  if (/exhausted balance|locked/i.test(text)) return 'fal.ai balance is empty. Top up at fal.ai/dashboard/billing and try again.'
  if (e?.status === 403 && /forbidden/i.test(text)) return 'fal.ai refused the request (Forbidden). Check the key and the account balance.'
  return text
}

export interface MediaJob {
  kind: MediaKind
  model: string
  prompt: string
  images: string[]
  count: number
  aspect: string
  duration: number
}

export async function generateMedia(s: Settings, job: MediaJob, onProgress: (msg: string) => void): Promise<{ urls: string[]; demo?: boolean }> {
  const def = getModel(job.model)
  if (!def) throw new Error('Unknown model')
  if (def.needsImage && !job.images.length) throw new Error('This needs an image selected')
  const count = Math.min(Math.max(job.count, 1), 4)
  if (!hasFal(s)) {
    if (job.kind !== 'image') throw new Error(`Add a fal.ai key in Settings to make ${MEDIA_LABEL[job.kind].toLowerCase()}`)
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700))
    return { urls: Array.from({ length: count }, (_, i) => demoImage(job.prompt, i)), demo: true }
  }
  const client = fal(s)
  if (job.images.some((u) => u.startsWith('data:'))) onProgress('Uploading reference')
  const images = await Promise.all(job.images.map((u) => (u.startsWith('data:') ? client.storage.upload(dataUrlToBlob(u)) : Promise.resolve(u))))
  const { endpoint, input } = def.build({ prompt: job.prompt, images, count, aspect: job.aspect, duration: job.duration })
  onProgress('Queued')
  let result
  try {
    result = await client.subscribe(endpoint, {
      input,
      onQueueUpdate: (u) => {
        if (u.status === 'IN_QUEUE') onProgress(u.queue_position != null ? `In queue · #${u.queue_position + 1}` : 'In queue')
        else if (u.status === 'IN_PROGRESS') onProgress('Generating')
      },
    })
  } catch (err) {
    throw new Error(falMessage(err))
  }
  const urls = extractMedia(result.data, job.kind)
  if (!urls.length) throw new Error('The model returned nothing')
  return { urls }
}

// ---------- Voice ----------

/** Speech to text for a recorded clip (needs a fal.ai key). */
export async function transcribe(s: Settings, audio: Blob): Promise<string> {
  if (!hasFal(s)) throw new Error('Add a fal.ai key to use the microphone here')
  const client = fal(s)
  const audio_url = await client.storage.upload(audio)
  const result = await client.subscribe('fal-ai/whisper', { input: { audio_url, task: 'transcribe' } })
  return String((result.data as { text?: string }).text ?? '').trim()
}

/** Speaks a reply: ElevenLabs via fal when a key is set, else the browser's own voice. Returns a stop function. */
export async function speak(s: Settings, text: string, onEnd: () => void): Promise<() => void> {
  if (hasFal(s)) {
    try {
      const result = await fal(s).subscribe('fal-ai/elevenlabs/tts/turbo-v2.5', { input: { text } })
      const url = extractMedia(result.data, 'audio')[0]
      if (url) {
        const a = new Audio(url)
        a.onended = onEnd
        a.onerror = onEnd
        await a.play()
        return () => {
          a.pause()
          onEnd()
        }
      }
    } catch {
      /* fall through to the browser voice */
    }
  }
  if (!('speechSynthesis' in window)) {
    onEnd()
    return () => {}
  }
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.05
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
  return () => {
    speechSynthesis.cancel()
    onEnd()
  }
}

// ---------- Demo mode (no keys yet) ----------

function hash(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function demoImage(prompt: string, i: number) {
  const h = hash(prompt + i * 7919)
  const a = h % 360
  const b = (a + 50 + (h % 90)) % 360
  const words = prompt.split(/\s+/).slice(0, 7).join(' ').replace(/[<&>"]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 75% 72%)"/><stop offset="1" stop-color="hsl(${b} 65% 48%)"/></linearGradient></defs>
<rect width="768" height="768" fill="url(#g)"/><circle cx="${220 + (h % 320)}" cy="${240 + ((h >> 3) % 260)}" r="${110 + (h % 90)}" fill="white" fill-opacity="0.22"/>
<rect x="${120 + ((h >> 5) % 300)}" y="${380 + ((h >> 2) % 200)}" width="${160 + (h % 120)}" height="${160 + (h % 120)}" rx="24" fill="white" fill-opacity="0.14"/>
<text x="36" y="712" font-family="Inter, system-ui" font-size="28" fill="white">${words}</text>
<text x="36" y="64" font-family="Inter, system-ui" font-size="20" fill="white" fill-opacity="0.8">DEMO · add a fal.ai key for real images</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A fixed remix, so the flow can be seen without keys: the Margin bookshop example. */
function demoRemix(base: (k: Action['kind'], content: string, model?: string, extra?: Partial<Action>) => Action, team: string[], tail: string): AgentReply {
  const ref = (who: string, title: string, content: string, link: number[] = []) =>
    base('note', content, '', { card: 'reference', who, title, use_selection: false, link_to: link.map((n) => `@${n}`) })
  const actions = [
    ref('Paula Scher', 'Public Theater identity, 1994', 'Steal: type at the scale of architecture. The building becomes the logo.'),
    ref('Dieter Rams', 'Braun products, 1955–95', 'Steal: one grid and few elements. Calm makes everything else louder.'),
    ref('Push Pin Studios', 'posters, 1950s–60s', 'Steal: mixing historical styles freely. Old Hebrew print can sit beside new type.', [0]),
    ref('Ulm School of Design', 'systems, 1953–68', 'Steal: one modular system that runs signs, shelves and labels.', [1]),
    ref('Constructivism', 'posters, 1920s', 'Steal: two colors and diagonals. Cheap to print, loud on a wall.', [2]),
    ref('White City, Tel Aviv', 'Bauhaus buildings, 1930s', 'Steal: horizontal bands and rounded corners, born of the local climate.', [3]),
    base('note', 'Signage grid doubles as shelf labels; giant letters run along the bookcases.', '', {
      card: 'direction',
      title: 'Shelf system',
      sources: ['Ulm School', 'Paula Scher'],
      constraint: 'One typeface, one grid.',
      color: '',
      use_selection: false,
      link_to: ['@3', '@0'],
    }),
    base('note', 'The bold one: every asset printed in-store on the letterpress, diagonals over Hebrew street lettering.', '', {
      card: 'direction',
      title: 'Two-colour press',
      sources: ['Constructivism', 'White City signage'],
      constraint: 'Red and black only.',
      use_selection: false,
      link_to: ['@4', '@5'],
    }),
  ]
  for (const id of team.slice(0, 3)) {
    const m = getMind(id)
    if (m) actions.push(base('note', `For the press: ${m.moves.split(';')[0].replace(/^./, (c) => c.toLowerCase())}. ${m.lens}`, '', { card: 'voice', mind: id, use_selection: false, link_to: ['@7'] }))
  }
  return {
    reply: 'A sample remix for a design bookshop: the lineage, what to steal from each, and two directions. The press one is the bold one.' + tail,
    actions,
    remove: [],
  }
}

function demoReply(text: string, ctx: AgentContext): AgentReply {
  const p = text.toLowerCase()
  const hasSel = ctx.selectedImages.length > 0
  const base = (k: Action['kind'], content: string, model = '', extra: Partial<Action> = {}): Action => ({
    kind: k,
    content,
    model,
    color: '',
    use_selection: hasSel,
    after: -1,
    count: 1,
    aspect: '1:1',
    card: '',
    who: '',
    title: '',
    sources: [],
    constraint: '',
    mind: '',
    link_to: [],
    ...extra,
  })
  const tail = ' (Demo: add an Anthropic key in Settings and I will really listen.)'
  if (!text.trim()) return { reply: 'Tell me what we are making.', actions: [], remove: [] }
  if (/\b(remix|steal|influences?|lineage|directions?)\b/.test(p)) return demoRemix(base, ctx.team, tail)
  if (/\b(3d|mesh|model of)\b/.test(p)) return { reply: 'Turning it into 3D with Trellis, the fast clean mesh.' + tail, actions: [base('model3d', text, 'trellis')], remove: [] }
  if (/\b(video|animate|clip|motion|film)\b/.test(p))
    return { reply: `Making a clip with Kling${hasSel ? ' from your image' : ''}.` + tail, actions: [base('video', text, 'kling-2.5', { aspect: '16:9' })], remove: [] }
  if (/\b(sound|music|song|audio|voice|sfx|ambient)\b/.test(p))
    return {
      reply: 'Composing that now.' + tail,
      actions: [base('audio', text, /voice|say|narrat/.test(p) ? 'voice' : /music|song|track/.test(p) ? 'music' : 'sfx')],
      remove: [],
    }
  if (/\b(ideas?|brainstorm|names?|taglines?|list|plan|write|script)\b/.test(p)) {
    const colors = ['yellow', 'pink', 'blue', 'green']
    return {
      reply: 'Here are four directions to react to.' + tail,
      actions: [`${text}: the quiet version`, `${text}: the loud version`, `${text}: as a 1970s poster`, `${text}: for kids`].map((c, i) => base('note', c, '', { color: colors[i] })),
      remove: [],
    }
  }
  const looks = ['warm film photo, golden hour', 'flat graphic poster, two colors', 'soft 3D render, pastel studio']
  return {
    reply: (hasSel ? 'Editing your selection with Nano Banana, three takes.' : 'Three quick directions with Flux Schnell, the fast one.') + tail,
    actions: looks.map((l) => base('image', `${text}, ${l}`, hasSel ? 'nano-banana' : 'flux-schnell')),
    remove: [],
  }
}
