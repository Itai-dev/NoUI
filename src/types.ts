export type MediaKind = 'image' | 'video' | 'audio' | 'model3d'
export type ItemKind = 'note' | MediaKind
/** Notes that carry structure: a credited influence, a remix direction, or a studio member's take. */
export type CardKind = 'reference' | 'direction' | 'voice'

/** Something standing or lying on the isometric floor. Positions are floor units (px on the floor plane). */
export interface Item {
  id: string
  kind: ItemKind
  x: number
  y: number
  w: number
  h: number
  text?: string // note body
  color?: string // note color key
  url?: string
  prompt?: string
  model?: string
  status?: 'running' | 'done' | 'error'
  progress?: string
  error?: string
  demo?: boolean
  from?: string[] // ids this was made from
  card?: CardKind
  who?: string // reference: the creator; voice: who is speaking
  title?: string // reference: the work and year; direction: its name
  sources?: string[] // direction: what it borrows from
  constraint?: string // direction: its one deliberate limit
  mind?: string // voice: studio member id
  links?: string[] // ids drawn as lines on the table (lineage, sources)
  createdAt: number
}

/** One thing the agent put on the table in a reply. */
export interface Step {
  kind: ItemKind
  card?: CardKind
  model?: string
  count: number
  prompt: string
}

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  at: number
  steps?: Step[]
}
