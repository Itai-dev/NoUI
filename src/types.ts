export type MediaKind = 'image' | 'video' | 'audio' | 'model3d'
export type ItemKind = 'note' | MediaKind

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
  createdAt: number
}

/** One thing the agent put on the table in a reply. */
export interface Step {
  kind: ItemKind
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
