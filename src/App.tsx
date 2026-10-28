import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { converse, detectServerKeys, generateMedia, hasClaude, hasFal, loadSettings, saveSettings, speak, summarizeBoard, type Action, type Settings } from './ai'
import Composer, { type AgentStatus, type ComposerHandle } from './Composer'
import { bounds, footprint, placeBatch, project, screenBox, sizeFor, uid } from './geometry'
import { Chevron, Menu, NewChat } from './Icons'
import Iso, { type View } from './Iso'
import { MAX_TEAM } from './minds'
import { defaultModel, getModel, NOTE_COLORS } from './models'
import StudioModal, { Studio } from './StudioModal'
import SettingsModal from './SettingsModal'
import Thread from './Thread'
import type { Item, MediaKind, Step, Turn } from './types'
import './App.css'

const BOARD_KEY = 'atelier.iso.v1'
const TEAM_KEY = 'atelier.team'

function loadTeam(): string[] {
  try {
    const t = JSON.parse(localStorage.getItem(TEAM_KEY) || '[]')
    return Array.isArray(t) ? t.slice(0, MAX_TEAM) : []
  } catch {
    return []
  }
}
const isMedia = (k: string): k is MediaKind => ['image', 'video', 'audio', 'model3d'].includes(k)

const MODEL_NAMES: Record<string, string> = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' }

function load(): { name: string; items: Item[]; turns: Turn[] } {
  try {
    const raw = localStorage.getItem(BOARD_KEY)
    if (!raw) return { name: 'Untitled table', items: [], turns: [] }
    const b = JSON.parse(raw)
    const items: Item[] = (b.items ?? []).map((it: Item) =>
      it.status === 'running' ? { ...it, status: 'error', progress: undefined, error: 'Interrupted by a reload' } : it,
    )
    return { name: b.name || 'Untitled table', items, turns: b.turns ?? [] }
  } catch {
    return { name: 'Untitled table', items: [], turns: [] }
  }
}

/** Downscale uploads so the table stays small enough to save in the browser. */
function readImage(file: File): Promise<{ url: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve({ url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height })
      }
      img.onerror = () => reject(new Error('Could not read image'))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const initial = useMemo(load, [])
  const [items, setItems] = useState<Item[]>(initial.items)
  const [turns, setTurns] = useState<Turn[]>(initial.turns)
  const [name, setName] = useState(initial.name)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>({ x: 0, y: -40, zoom: 0.9 })
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [serverKeys, setServerKeys] = useState({ anthropic: false, fal: false })
  useEffect(() => {
    detectServerKeys().then((k) => setServerKeys({ ...k }))
  }, [])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [talk, setTalkState] = useState(() => localStorage.getItem('atelier.talk') === 'on')
  const setTalk = useCallback((v: boolean) => {
    setTalkState(v)
    try {
      localStorage.setItem('atelier.talk', v ? 'on' : 'off')
    } catch {
      /* storage unavailable */
    }
  }, [])
  const [showSettings, setShowSettings] = useState(false)
  const [team, setTeamState] = useState<string[]>(loadTeam)
  const [showStudio, setShowStudio] = useState(false)
  const setTeam = useCallback((ids: string[]) => {
    setTeamState(ids)
    try {
      localStorage.setItem(TEAM_KEY, JSON.stringify(ids))
    } catch {
      /* storage unavailable */
    }
  }, [])
  const [lightbox, setLightbox] = useState<Item | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const stopSpeaking = useRef<(() => void) | null>(null)
  const lastBatch = useRef<string[]>([])
  const talkRef = useRef(talk)
  talkRef.current = talk
  const itemsRef = useRef(items)
  itemsRef.current = items

  const say = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 6000)
  }, [])

  // Autosave
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(BOARD_KEY, JSON.stringify({ name, items, turns: turns.slice(-40) }))
      } catch {
        say('The table is too big to autosave in this browser.')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [items, turns, name, say])

  const patch = useCallback((id: string, p: Partial<Item>) => setItems((is) => is.map((it) => (it.id === id ? { ...it, ...p } : it))), [])

  // ----- Generation -----
  const fill = useCallback(
    async (ids: string[], job: Parameters<typeof generateMedia>[1]): Promise<string | null> => {
      const set = (p: Partial<Item>) => setItems((is) => is.map((it) => (ids.includes(it.id) ? { ...it, ...p } : it)))
      try {
        const { urls, demo } = await generateMedia(settings, job, (progress) => set({ progress }))
        setItems((is) => is.map((it) => (ids.includes(it.id) ? { ...it, url: urls[ids.indexOf(it.id)] ?? urls[0], demo, status: 'done', progress: undefined } : it)))
        return urls[0]
      } catch (err) {
        set({ status: 'error', progress: undefined, error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },
    [settings],
  )

  /** Centers the window on a set of items. */
  const focusOn = useCallback((targets: Item[]) => {
    const b = bounds(targets.map(footprint))
    if (!b) return
    const c = project(b.x + b.w / 2, b.y + b.h / 2)
    setView((v) => ({ ...v, x: -c.x * v.zoom, y: -c.y * v.zoom + 40 }))
  }, [])

  /** Places the agent's actions on the table and starts their generation. Returns what was added, for the thread. */
  const applyActions = useCallback(
    (actions: Action[], selImages: string[]): Step[] => {
      const current = itemsRef.current
      const sel = current.filter((it) => selected.has(it.id))
      const anchorItems = sel.length ? sel : current.filter((it) => lastBatch.current.includes(it.id))
      const anchor = bounds(anchorItems.map(screenBox))
      // ×N variations become N placeholders filled by one call.
      const expanded = actions.flatMap((a, idx) => Array.from({ length: isMedia(a.kind) ? Math.min(a.count || 1, 4) : 1 }, () => ({ a, idx })))
      const sizes = expanded.map(({ a }) => sizeFor(a.kind, a.aspect, a.kind === 'note' ? a.card : ''))
      const spots = placeBatch(
        expanded.map((e, i) => ({ kind: e.a.kind, ...sizes[i] })),
        anchor,
        current.map(screenBox),
      )
      const now = Date.now()
      const ids = expanded.map(() => uid())
      // "@N" points at the first item made for action N in this reply; anything else must already be on the table.
      const firstOf = new Map<number, string>()
      expanded.forEach(({ idx }, i) => firstOf.has(idx) || firstOf.set(idx, ids[i]))
      const known = new Set(current.map((it) => it.id))
      const resolve = (refs: string[] = []) =>
        refs.map((r) => (r.startsWith('@') ? firstOf.get(Number(r.slice(1))) : known.has(r) ? r : undefined)).filter((r): r is string => !!r)
      const created: Item[] = expanded.map(({ a }, i) => {
        const links = resolve(a.link_to).filter((l) => l !== ids[i])
        const base = { id: ids[i], x: spots[i].x, y: spots[i].y, w: sizes[i].w, h: sizes[i].h, createdAt: now + i, from: sel.map((s) => s.id), ...(links.length ? { links } : {}) }
        if (a.kind === 'note') {
          const note: Item = { ...base, kind: 'note', text: a.content, color: a.color in NOTE_COLORS ? a.color : 'yellow' }
          if (a.card === 'reference') return { ...note, card: 'reference', who: a.who, title: a.title }
          if (a.card === 'direction') return { ...note, card: 'direction', title: a.title, sources: a.sources, constraint: a.constraint }
          if (a.card === 'voice') return { ...note, card: 'voice', mind: a.mind || undefined, who: a.who }
          return note
        }
        const model = a.model && getModel(a.model)?.kind === a.kind ? a.model : defaultModel(a.kind)
        const waits = a.after >= 0 && a.after < actions.length
        return { ...base, kind: a.kind, prompt: a.content, model, status: 'running', progress: waits ? `Waiting for step ${a.after + 1}` : 'Starting' }
      })
      setItems((is) => [...is, ...created])
      lastBatch.current = created.map((c) => c.id)
      setSelected(new Set())
      setTimeout(() => focusOn(created), 30)

      // Run media, honoring chains ("after") and shared variation batches.
      const results: Promise<string | null>[] = []
      const steps: Step[] = []
      let i = 0
      while (i < expanded.length) {
        const { a, idx } = expanded[i]
        const group = expanded.filter((e) => e.idx === idx).length
        const ids = created.slice(i, i + group).map((c) => c.id)
        steps.push({ kind: a.kind, card: a.kind === 'note' && a.card ? a.card : undefined, model: created[i].model, count: group, prompt: a.content })
        if (isMedia(a.kind)) {
          const model = created[i].model!
          const upstream = a.after >= 0 && a.after < idx ? results[a.after] : null
          const run = (async () => {
            const prev = upstream ? await upstream : null
            if (upstream && prev) setItems((is) => is.map((it) => (ids.includes(it.id) ? { ...it, progress: 'Starting' } : it)))
            if (upstream && !prev) {
              setItems((is) => is.map((it) => (ids.includes(it.id) ? { ...it, status: 'error', progress: undefined, error: 'The item this builds on failed' } : it)))
              return null
            }
            const images = prev ? [prev] : a.use_selection || getModel(model)?.needsImage ? selImages : []
            return fill(ids, { kind: a.kind as MediaKind, model, prompt: a.content, images, count: group, aspect: a.aspect, duration: a.kind === 'audio' ? 8 : 5 })
          })()
          results[idx] = run
        } else results[idx] = Promise.resolve(null)
        i += group
      }
      return steps
    },
    [fill, focusOn, selected],
  )

  // ----- Talking to the agent -----
  const interrupt = useCallback(() => {
    stopSpeaking.current?.()
    stopSpeaking.current = null
  }, [])

  const send = useCallback(
    async (text: string) => {
      interrupt()
      const at = Date.now()
      setTurns((t) => [...t, { role: 'user', text, at }])
      setStatus('thinking')
      try {
        const current = itemsRef.current
        const selImages = current.filter((it) => selected.has(it.id) && it.kind === 'image' && it.url && it.status !== 'running').map((it) => it.url!)
        const reply = await converse(settings, turns, text, { board: summarizeBoard(current, selected), selectedImages: selImages, team })
        if (reply.remove.length) {
          const gone = new Set(reply.remove)
          setItems((is) => is.filter((it) => !gone.has(it.id)))
        }
        const steps = reply.actions.length ? applyActions(reply.actions, selImages) : undefined
        setTurns((t) => [...t, { role: 'assistant', text: reply.reply, at: Date.now(), steps }])
        if (settings.speak && reply.reply) {
          setStatus('speaking')
          const spoken = reply.reply.replace(/\s*\(Demo:.*\)$/, '')
          stopSpeaking.current = await speak(settings, spoken, () => {
            stopSpeaking.current = null
            setStatus('idle')
            if (talkRef.current) composer.current?.listen()
          })
        } else {
          setStatus('idle')
          if (talkRef.current) composer.current?.listen()
        }
      } catch (err) {
        setStatus('idle')
        // Keep the error in the conversation so it can be read later, not just in a passing toast.
        const msg = err instanceof Error ? err.message : String(err)
        setTurns((t) => [...t, { role: 'assistant', text: `Something went wrong: ${msg}`, at: Date.now() }])
      }
    },
    [applyActions, interrupt, selected, settings, team, turns],
  )

  const newTable = useCallback(() => {
    if ((items.length || turns.length) && !window.confirm('Start a new table? The current one and its conversation will be cleared.')) return
    interrupt()
    setItems([])
    setTurns([])
    setSelected(new Set())
    setName('Untitled table')
    setView({ x: 0, y: -40, zoom: 0.9 })
    composer.current?.focus()
  }, [interrupt, items.length, turns.length])

  // ----- Table interactions -----
  const onSelect = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => {
      if (!additive) return new Set(ids)
      const next = new Set(prev)
      ids.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)))
      return next
    })
  }, [])

  const onMove = useCallback(
    (id: string, dx: number, dy: number) => {
      const ids = selected.has(id) ? selected : new Set([id])
      setItems((is) => is.map((it) => (ids.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it)))
    },
    [selected],
  )

  const addImage = useCallback(
    async (file: File) => {
      try {
        const { url, w, h } = await readImage(file)
        const size = { w: 260, h: Math.round((260 * h) / w) }
        const current = itemsRef.current
        const anchor = bounds(current.filter((it) => lastBatch.current.includes(it.id)).map(screenBox))
        const [spot] = placeBatch([{ kind: 'image', ...size }], anchor, current.map(screenBox))
        const item: Item = { id: uid(), kind: 'image', ...spot, ...size, url, status: 'done', prompt: file.name, createdAt: Date.now() }
        setItems((is) => [...is, item])
        lastBatch.current = [item.id]
        setSelected(new Set([item.id]))
        setTimeout(() => focusOn([item]), 30)
      } catch {
        say('That image could not be read.')
      }
    },
    [focusOn, say],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        setItems((is) => is.filter((it) => !selected.has(it.id)))
        setSelected(new Set())
      } else if (e.key === 'Escape') setSelected(new Set())
      else if (e.key === '/') {
        e.preventDefault()
        composer.current?.focus()
      } else if (e.key === ' ' && !e.repeat) {
        e.preventDefault()
        composer.current?.listen()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        addImage(file)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [addImage, selected])

  const selectedItems = items.filter((it) => selected.has(it.id))
  const winStatus = selectedItems.length
    ? `${selectedItems.length} selected${selectedItems.length === 1 && selectedItems[0].kind === 'note' ? ` · “${(selectedItems[0].text ?? '').slice(0, 40)}”` : ''}`
    : `${items.length} item${items.length === 1 ? '' : 's'} · ${Math.round(view.zoom * 100)}%`
  const keysMissing = !hasClaude(settings) || !hasFal(settings)
  void serverKeys // re-render once the server reports its keys

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
        if (file) {
          e.preventDefault()
          addImage(file)
        }
      }}
    >
      <header className="top">
        <button className="icon" title="Settings" onClick={() => setShowSettings(true)}>
          <Menu />
        </button>
        <button className="brand" title="Agent model and settings" onClick={() => setShowSettings(true)}>
          Atelier
          <span className="model">
            {MODEL_NAMES[settings.claudeModel] ?? settings.claudeModel}
            <Chevron />
          </span>
        </button>
        <span className="spacer" />
        <button className="studio-btn" title="Your studio: creative minds in the room" onClick={() => setShowStudio(true)}>
          <Studio ids={team} />
        </button>
        {keysMissing && (
          <button className="demo-chip" onClick={() => setShowSettings(true)}>
            Demo<span className="long"> mode</span> · add keys
          </button>
        )}
        <button className="icon" title="New table" onClick={newTable}>
          <NewChat />
        </button>
      </header>

      <div className="body">
        <section className="chat">
          <Thread turns={turns} status={status} onInterrupt={interrupt} onSuggest={send} team={team} />
          <Composer ref={composer} settings={settings} status={status} talk={talk} setTalk={setTalk} onSend={send} onAttach={addImage} onInterrupt={interrupt} onError={say} />
        </section>
        <section className="canvas">
          <Iso
            items={items}
            selected={selected}
            view={view}
            setView={setView}
            onSelect={onSelect}
            onMove={onMove}
            onOpen={(it) => it.kind !== 'note' && it.url && setLightbox(it)}
            onEdit={(id, text) => patch(id, { text })}
            title={name}
            status={winStatus}
          />
        </section>
      </div>

      {toast && <div className="toast">{toast}</div>}
      {showSettings && (
        <SettingsModal
          value={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            saveSettings(s)
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}
      {showStudio && <StudioModal value={team} onClose={() => setShowStudio(false)} onSave={(ids) => (setTeam(ids), setShowStudio(false))} />}
      {lightbox && (
        <div className="overlay" onClick={() => setLightbox(null)}>
          {lightbox.kind === 'video' ? (
            <video className="lightbox" src={lightbox.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
          ) : lightbox.kind === 'image' ? (
            <img className="lightbox" src={lightbox.url} alt="" />
          ) : null}
        </div>
      )}
    </div>
  )
}
