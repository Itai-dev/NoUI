import type { MediaKind } from './types'

export interface BuildArgs {
  prompt: string
  images: string[]
  count: number
  aspect: string
  duration: number
}

export interface ModelDef {
  id: string // our key, stored on the node
  label: string
  kind: MediaKind
  needsImage?: boolean
  when: string // guidance for the agent on when to pick this model
  /** Returns the fal endpoint and its input. May depend on whether an image is connected. */
  build: (a: BuildArgs) => { endpoint: string; input: Record<string, unknown> }
}

const fluxSize: Record<string, string> = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3',
  '3:4': 'portrait_4_3',
}

export const MODELS: ModelDef[] = [
  // Image
  {
    id: 'nano-banana',
    label: 'Nano Banana (text or edit)',
    kind: 'image',
    when: "Default for most images. Best at following detailed prompts, legible text in images, and editing or restyling a reference image while keeping its subject.",
    build: (a) =>
      a.images.length
        ? { endpoint: 'fal-ai/nano-banana/edit', input: { prompt: a.prompt, image_urls: a.images, num_images: a.count } }
        : { endpoint: 'fal-ai/nano-banana', input: { prompt: a.prompt, num_images: a.count, aspect_ratio: a.aspect } },
  },
  {
    id: 'flux-schnell',
    label: 'Flux Schnell (fastest)',
    kind: 'image',
    when: "Fastest and cheapest. Rough drafts, quick explorations, many variations where polish does not matter.",
    build: (a) => ({
      endpoint: 'fal-ai/flux/schnell',
      input: { prompt: a.prompt, num_images: a.count, image_size: fluxSize[a.aspect] ?? 'square_hd' },
    }),
  },
  {
    id: 'seedream-4',
    label: 'Seedream 4',
    kind: 'image',
    when: "Highest photoreal fidelity and rich detail; good for premium product shots and realistic scenes.",
    build: (a) => ({
      endpoint: 'fal-ai/bytedance/seedream/v4/text-to-image',
      input: { prompt: a.prompt, num_images: a.count, image_size: fluxSize[a.aspect] ?? 'square_hd' },
    }),
  },
  {
    id: 'recraft-vector',
    label: 'Recraft V3 (vector style)',
    kind: 'image',
    when: "Flat vector illustration: logos, icons, stickers, infographics, anything that should look like clean vector art.",
    build: (a) => ({
      endpoint: 'fal-ai/recraft/v3/text-to-image',
      input: { prompt: a.prompt, style: 'vector_illustration', image_size: fluxSize[a.aspect] ?? 'square_hd' },
    }),
  },
  {
    id: 'flux-kontext',
    label: 'Flux Kontext (edit image)',
    kind: 'image',
    when: "Precise edits of an existing image: change one thing, keep everything else. Needs an image.",
    needsImage: true,
    build: (a) => ({
      endpoint: 'fal-ai/flux-pro/kontext',
      input: { prompt: a.prompt, image_url: a.images[0], num_images: a.count, aspect_ratio: a.aspect },
    }),
  },

  // Video
  {
    id: 'kling-2.5',
    label: 'Kling 2.5 Turbo (text or image)',
    kind: 'video',
    when: "Default for video. Strong motion and camera moves; turns an image into a clip when one is given.",
    build: (a) =>
      a.images.length
        ? {
            endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
            input: { prompt: a.prompt, image_url: a.images[0], duration: a.duration >= 10 ? '10' : '5' },
          }
        : {
            endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
            input: {
              prompt: a.prompt,
              duration: a.duration >= 10 ? '10' : '5',
              aspect_ratio: ['16:9', '9:16', '1:1'].includes(a.aspect) ? a.aspect : '16:9',
            },
          },
  },
  {
    id: 'veo3-fast',
    label: 'Veo 3 Fast (with sound)',
    kind: 'video',
    when: "Video with generated sound (dialogue, ambience). Use when audio in the clip matters. Text only.",
    build: (a) => ({
      endpoint: 'fal-ai/veo3/fast',
      input: {
        prompt: a.prompt,
        duration: a.duration <= 4 ? '4s' : a.duration <= 6 ? '6s' : '8s',
        aspect_ratio: a.aspect === '9:16' ? '9:16' : '16:9',
        generate_audio: true,
      },
    }),
  },
  {
    id: 'hailuo-02',
    label: 'Hailuo 02',
    kind: 'video',
    when: "Stylised, expressive motion; good for characters and action. Text only.",
    build: (a) => ({
      endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
      input: { prompt: a.prompt, duration: a.duration >= 10 ? '10' : '6' },
    }),
  },

  // Audio
  {
    id: 'sfx',
    label: 'Sound effect (ElevenLabs)',
    kind: 'audio',
    when: "A single sound effect (door creak, whoosh, rain). Describe the sound.",
    build: (a) => ({
      endpoint: 'fal-ai/elevenlabs/sound-effects/v2',
      input: { text: a.prompt, duration_seconds: Math.min(Math.max(a.duration, 1), 22) },
    }),
  },
  {
    id: 'music',
    label: 'Music (Lyria 2)',
    kind: 'audio',
    when: "Instrumental music from a description of genre, mood and tempo.",
    build: (a) => ({ endpoint: 'fal-ai/lyria2', input: { prompt: a.prompt } }),
  },
  {
    id: 'voice',
    label: 'Voiceover (ElevenLabs)',
    kind: 'audio',
    when: "Spoken voiceover or narration. The prompt is the exact words to speak.",
    build: (a) => ({ endpoint: 'fal-ai/elevenlabs/tts/multilingual-v2', input: { text: a.prompt } }),
  },

  // 3D
  {
    id: 'trellis',
    label: 'Trellis (image → 3D)',
    kind: 'model3d',
    when: "Default image to 3D model: clean textured mesh, fast.",
    needsImage: true,
    build: (a) => ({ endpoint: 'fal-ai/trellis', input: { image_url: a.images[0] } }),
  },
  {
    id: 'hunyuan3d',
    label: 'Hunyuan3D 2 (image → 3D)',
    kind: 'model3d',
    when: "Image to 3D with higher geometric detail; slower.",
    needsImage: true,
    build: (a) => ({ endpoint: 'fal-ai/hunyuan3d/v2', input: { input_image_url: a.images[0], textured_mesh: true } }),
  },
]

export const modelsFor = (kind: MediaKind) => MODELS.filter((m) => m.kind === kind)
export const getModel = (id?: string) => MODELS.find((m) => m.id === id)
export const defaultModel = (kind: MediaKind) => modelsFor(kind)[0].id

export const NOTE_COLORS: Record<string, string> = {
  yellow: '#FFE68A',
  orange: '#FFC79A',
  pink: '#FFB8DF',
  violet: '#D9C6FF',
  blue: '#B1DAFF',
  green: '#C6EFA9',
  gray: '#ECECEC',
}
export const MEDIA_LABEL: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Sound', model3d: '3D' }

/** The model guide the agent reads before choosing. */
export const MODEL_GUIDE = MODELS.map((m) => `- ${m.id} [${m.kind}]: ${m.when}${m.needsImage ? ' (needs an image)' : ''}`).join('\n')
