import type { CardKind, Item, ItemKind } from './types'

// The floor is rotated rotateX(TILT) rotateZ(TURN) with no perspective (orthographic),
// which is what makes it read as isometric.
export const TILT = 55 // degrees
export const TURN = 45
const C45 = Math.cos((TURN * Math.PI) / 180)
const CT = Math.cos((TILT * Math.PI) / 180)

/** Floor point -> screen offset (before pan and zoom). */
export function project(fx: number, fy: number) {
  return { x: (fx - fy) * C45, y: (fx + fy) * C45 * CT }
}

/** Screen delta -> floor delta (before zoom). */
export function unproject(sx: number, sy: number) {
  const u = sx / C45
  const v = sy / (C45 * CT)
  return { x: (u + v) / 2, y: (v - u) / 2 }
}

let seq = 0
export const uid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`

const ASPECT: Record<string, number> = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4 }

/** Footprint on the floor (w across, h deep) and, for standing items, their height. */
export function sizeFor(kind: ItemKind, aspect = '1:1', card?: CardKind | '') {
  const r = ASPECT[aspect] ?? 1
  switch (kind) {
    case 'note':
      return card === 'reference' || card === 'direction' ? { w: 230, h: 210 } : card === 'voice' ? { w: 210, h: 190 } : { w: 180, h: 180 }
    case 'image':
      return r >= 1 ? { w: 260, h: Math.round(260 / r) } : { w: Math.round(300 * r), h: 300 }
    case 'video':
      return r >= 1 ? { w: 320, h: Math.round(320 / r) } : { w: Math.round(340 * r), h: 340 }
    case 'audio':
      return { w: 200, h: 90 }
    case 'model3d':
      return { w: 240, h: 240 }
  }
}

/** Standing items occupy a shallow strip on the floor; notes lie flat. */
export function footprint(it: Item) {
  return it.kind === 'note' ? { x: it.x, y: it.y, w: it.w, h: it.h } : { x: it.x, y: it.y, w: it.w, h: 60 }
}

export type Rect = { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

// Layout happens in screen space (what the viewer sees), then converts back to the floor,
// so rows run left to right on screen instead of down the floor's diagonal.
const LABEL = 30 // room under a standing card for its label
const PAD = 12 // the card's white border

export function screenSize(kind: ItemKind, w: number, h: number) {
  if (kind === 'note') return { w: (w + h) * C45, h: (w + h) * C45 * CT }
  return { w: w + PAD, h: h + PAD + LABEL }
}

/** The box an item covers on screen (unzoomed scene coordinates). */
export function screenBox(it: Item): Rect {
  const s = screenSize(it.kind, it.w, it.h)
  if (it.kind === 'note') {
    const c = project(it.x + it.w / 2, it.y + it.h / 2)
    return { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }
  }
  const fp = footprint(it)
  const c = project(fp.x + fp.w / 2, fp.y + fp.h / 2)
  return { x: c.x - s.w / 2, y: c.y - s.h + LABEL, w: s.w, h: s.h }
}

/** Floor position (top-left of the footprint) for an item whose screen box is known. */
function floorFromScreen(kind: ItemKind, w: number, h: number, box: Rect) {
  if (kind === 'note') {
    const c = unproject(box.x + box.w / 2, box.y + box.h / 2)
    return { x: c.x - w / 2, y: c.y - h / 2 }
  }
  const c = unproject(box.x + box.w / 2, box.y + box.h - LABEL)
  return { x: c.x - w / 2, y: c.y - 30 }
}

/**
 * Finds floor spots for a batch: in rows to the right of the anchor (a selection, or the
 * last thing made), wrapping to new rows below, never covering what's already there.
 */
export function placeBatch(news: { kind: ItemKind; w: number; h: number }[], anchor: Rect | null, taken: Rect[]): { x: number; y: number }[] {
  const gap = 28
  const used = [...taken]
  const out: { x: number; y: number }[] = []
  const startX = anchor ? anchor.x + anchor.w + gap * 2 : -((news.length > 3 ? 3 : news.length) * 150)
  let x = startX
  let y = anchor ? anchor.y : -120
  let rowH = 0
  let col = 0
  for (const n of news) {
    const s = screenSize(n.kind, n.w, n.h)
    let tries = 0
    while (used.some((u) => overlaps({ x, y, w: s.w, h: s.h }, u, gap / 2)) && tries < 300) {
      x += 24
      if (x > startX + 1300) {
        x = startX
        y += 40
      }
      tries++
    }
    const box = { x, y, w: s.w, h: s.h }
    used.push(box)
    out.push(floorFromScreen(n.kind, n.w, n.h, box))
    rowH = Math.max(rowH, s.h)
    col++
    x += s.w + gap
    if (col % 4 === 0 || x > startX + 1300) {
      x = startX
      y += rowH + gap
      rowH = 0
    }
  }
  return out
}
