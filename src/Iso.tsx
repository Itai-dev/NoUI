import '@google/model-viewer'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { footprint, project, TILT, TURN, unproject } from './geometry'
import { getMind } from './minds'
import { getModel, MEDIA_LABEL, NOTE_COLORS } from './models'
import type { Item } from './types'

export interface View {
  x: number // pan, in screen px
  y: number
  zoom: number
}

interface Props {
  items: Item[]
  selected: Set<string>
  view: View
  setView: (f: (v: View) => View) => void
  onSelect: (ids: string[], additive: boolean) => void
  onMove: (id: string, dx: number, dy: number) => void // floor delta
  onOpen: (item: Item) => void
  onEdit: (id: string, text: string) => void
  title: string
  status?: string
}

/** The window with the isometric table inside. */
export default function Iso({ items, selected, view, setView, onSelect, onMove, onOpen, onEdit, title, status }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'item'; id?: string; x: number; y: number; moved: boolean } | null>(null)

  // Wheel: zoom with ctrl/pinch, otherwise pan
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015)
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left - rect.width / 2
        const my = e.clientY - rect.top - rect.height / 2
        setView((v) => {
          const zoom = Math.min(2.5, Math.max(0.25, v.zoom * factor))
          const k = zoom / v.zoom
          return { zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
        })
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return
      if ((e.target as HTMLElement).closest('a')) return // let links on cards open
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')
      if (target?.dataset.item && e.button === 0 && !(e.target as HTMLElement).closest('[data-ui]')) {
        drag.current = { kind: 'item', id: target.dataset.item, x: e.clientX, y: e.clientY, moved: false }
        if (!selected.has(target.dataset.item)) onSelect([target.dataset.item], e.shiftKey)
      } else drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [onSelect, selected],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = true
      d.x = e.clientX
      d.y = e.clientY
      if (d.kind === 'pan') setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
      else if (d.id) {
        const f = unproject(dx / view.zoom, dy / view.zoom)
        onMove(d.id, f.x, f.y)
      }
    },
    [onMove, setView, view.zoom],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (!d.moved && d.kind === 'pan') onSelect([], false)
      if (!d.moved && d.kind === 'item' && d.id && selected.has(d.id) && e.shiftKey) onSelect([d.id], true)
    },
    [onSelect, selected],
  )

  const floorTransform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom}) rotateX(${TILT}deg) rotateZ(${TURN}deg)`

  return (
    <div className="win">
      <div className="win-bar">
        <span className="win-title">{title}</span>
        <span className="win-status">{status}</span>
      </div>
      <div
        ref={ref}
        className="scene"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const t = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')
          const it = t && items.find((i) => i.id === t.dataset.item)
          if (it) onOpen(it)
        }}
      >
        <div className="floor" style={{ transform: floorTransform }}>
          <div className="grid" />
          <Links items={items} />
          {items.map((it) => (
            <ItemView key={it.id} item={it} selected={selected.has(it.id)} onEdit={onEdit} />
          ))}
        </div>
        {items.length === 0 && (
          <div className="empty">
            <strong>The table is empty.</strong>
            <span>Say or type what you want to make.</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Lines on the floor between linked items: lineage, a direction's sources, what a voice reacts to. */
const Links = memo(function Links({ items }: { items: Item[] }) {
  const byId = new Map(items.map((it) => [it.id, it]))
  const center = (it: Item) => {
    const f = footprint(it)
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
  }
  const lines = items.flatMap((it) =>
    (it.links ?? [])
      .map((id) => byId.get(id))
      .filter((t): t is Item => !!t)
      .map((t) => ({ key: `${it.id}-${t.id}`, a: center(it), b: center(t), dir: it.card === 'direction' })),
  )
  if (!lines.length) return null
  return (
    <svg className="links" width="1" height="1">
      {lines.map((l) => (
        <g key={l.key} className={l.dir ? 'dir' : ''}>
          <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />
          <circle cx={l.b.x} cy={l.b.y} r="5" />
        </g>
      ))}
    </svg>
  )
})

const searchUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

function Card({ it, onEdit }: { it: Item; onEdit: (id: string, text: string) => void }) {
  if (it.card === 'reference')
    return (
      <>
        <div className="card-kicker">Steal from</div>
        <div className="card-who">{it.who}</div>
        <div className="card-title">
          {it.title}{' '}
          <a href={searchUrl(`${it.who} ${it.title}`)} target="_blank" rel="noreferrer" title="Look up the original">
            ↗
          </a>
        </div>
        <NoteText id={it.id} text={it.text ?? ''} onEdit={onEdit} size="sm" />
      </>
    )
  if (it.card === 'direction') {
    const sources = it.sources ?? []
    return (
      <>
        <div className="card-kicker">Direction</div>
        <div className="card-who">{it.title}</div>
        <div className="card-title">{sources.join(' × ')}</div>
        <NoteText id={it.id} text={it.text ?? ''} onEdit={onEdit} size="sm" />
        {it.constraint && <div className="card-constraint">Constraint: {it.constraint}</div>}
        {sources.length < 2 && <div className="card-flag">One source only: remix it with another</div>}
      </>
    )
  }
  const mind = getMind(it.mind)
  return (
    <>
      <div className="card-kicker">{mind ? `${mind.short} · ${mind.years}` : it.who || 'Studio'}</div>
      <NoteText id={it.id} text={it.text ?? ''} onEdit={onEdit} size="md" />
    </>
  )
}

const ItemView = memo(function ItemView({ item: it, selected, onEdit }: { item: Item; selected: boolean; onEdit: (id: string, text: string) => void }) {
  const fp = footprint(it)
  if (it.kind === 'note' && it.card) {
    const bg = it.card === 'voice' ? (getMind(it.mind)?.color ?? NOTE_COLORS.gray) : it.card === 'direction' ? '#1f1d1a' : '#fbfaf7'
    return (
      <div data-item={it.id} className={`note cardnote card-${it.card} ${selected ? 'sel' : ''}`} style={{ left: it.x, top: it.y, width: it.w, height: it.h, background: bg }}>
        <Card it={it} onEdit={onEdit} />
      </div>
    )
  }
  if (it.kind === 'note') {
    return (
      <div
        data-item={it.id}
        className={`note ${selected ? 'sel' : ''}`}
        style={{ left: it.x, top: it.y, width: it.w, height: it.h, background: NOTE_COLORS[it.color ?? 'yellow'] }}
      >
        <NoteText id={it.id} text={it.text ?? ''} onEdit={onEdit} />
      </div>
    )
  }
  // Standing items: a shadow on the floor and a card that faces the viewer, anchored at its bottom edge.
  const label = `${MEDIA_LABEL[it.kind]}${getModel(it.model) ? ` · ${getModel(it.model)!.label.replace(/\s*\(.*\)/, '')}` : ''}${it.demo ? ' · demo' : ''}`
  return (
    <div data-item={it.id} className={`stand ${selected ? 'sel' : ''} kind-${it.kind}`} style={{ left: fp.x, top: fp.y, width: fp.w, height: fp.h }}>
      <div className="shadow" />
      <div className="card-anchor">
        <div className="card" style={{ width: it.w, height: it.h }}>
          {it.status === 'running' ? (
            <div className="making">
              <div className="making-text">{it.prompt}</div>
              <div className="making-status"><span className="spinner" />{it.progress ?? 'Working'}</div>
            </div>
          ) : it.status === 'error' ? (
            <div className="failed">
              <strong>Couldn't make this</strong>
              <span>{it.error}</span>
            </div>
          ) : it.kind === 'image' ? (
            <img src={it.url} alt={it.prompt ?? ''} draggable={false} />
          ) : it.kind === 'video' ? (
            <video src={it.url} controls loop playsInline data-ui />
          ) : it.kind === 'audio' ? (
            <div className="audio">
              <div className="audio-text">♪ {it.prompt}</div>
              <audio src={it.url} controls data-ui />
            </div>
          ) : (
            <model-viewer src={it.url} camera-controls auto-rotate shadow-intensity="1" data-ui />
          )}
          <div className="card-label">{label}</div>
        </div>
      </div>
    </div>
  )
})

function NoteText({ id, text, onEdit, size: fixed }: { id: string; text: string; onEdit: (id: string, text: string) => void; size?: 'sm' | 'md' }) {
  const [editing, setEditing] = useState(false)
  const size = fixed ?? (text.length < 40 ? 'lg' : text.length < 100 ? 'md' : 'sm')
  if (editing)
    return (
      <textarea
        data-ui
        autoFocus
        className={`note-text ${size}`}
        value={text}
        onChange={(e) => onEdit(id, e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') setEditing(false)
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  return (
    <div className={`note-text ${size}`} onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>
      {text}
    </div>
  )
}

/** Where a floor point lands on screen, for anything drawn outside the 3D floor. */
export function toScreen(view: View, fx: number, fy: number) {
  const p = project(fx, fy)
  return { x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom }
}
