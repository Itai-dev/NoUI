import '@google/model-viewer'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { footprint, project, TILT, TURN, unproject } from './geometry'
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
        <span className="lights"><i /><i /><i /></span>
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

const ItemView = memo(function ItemView({ item: it, selected, onEdit }: { item: Item; selected: boolean; onEdit: (id: string, text: string) => void }) {
  const fp = footprint(it)
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

function NoteText({ id, text, onEdit }: { id: string; text: string; onEdit: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const size = text.length < 40 ? 'lg' : text.length < 100 ? 'md' : 'sm'
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
