// Shared pieces: formatting, icons, dialog, media tile, the run (budget approval) dialog and the asset viewer.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ACTIVE_JOB } from '../shared/types.ts'
import type { Asset, Estimate, Job, JobStatus, ModelInfo, PlanItem, ProjectView, Quote, RunLine, StudioStatus } from '../shared/types.ts'
import { api, ApiFailure } from './api.ts'

// ---------- Context handed to every view ----------

export type ViewName = 'brief' | 'production' | 'assets'

export interface Ctx {
  project: ProjectView
  status: StudioStatus
  /** Runs a server call, applies the returned project, reports failures. Resolves true on success. */
  act: (fn: () => Promise<ProjectView>) => Promise<boolean>
  openRun: (lines?: RunLine[]) => void
  openViewer: (assetId: string) => void
  go: (view: ViewName) => void
}

// ---------- Formatting ----------

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'unknown'
  if (n === 0) return '$0.00'
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

export function estimateLabel(e: Estimate | undefined): string {
  if (!e) return 'unknown'
  if (e.usd === null) return 'Unknown cost'
  return `${e.approximate ? '≈ ' : ''}${usd(e.usd)}`
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const STAGE_LABEL = { brief: 'Brief', concepts: 'Concepts', plan: 'Plan', production: 'Production', delivery: 'Delivery' } as const

export const JOB_LABEL: Record<JobStatus, string> = {
  pending: 'Waiting',
  submitting: 'Submitting',
  queued: 'In queue',
  running: 'Generating',
  saving: 'Saving',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const isActive = (j: Job) => ACTIVE_JOB.includes(j.status)

export function priceLabel(m: ModelInfo): string {
  return m.price ? `${usd(m.price.unitPrice)} / ${m.price.unit}` : 'price unknown'
}

export function errorText(e: unknown): string {
  return e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : String(e)
}

/** Generated outputs of one plan item, newest first. */
export function outputsOf(project: ProjectView, itemId: string): Asset[] {
  return project.assets.filter((a) => a.itemId === itemId && a.origin !== 'reference').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function fileName(a: Asset, title: string): string {
  const ext = a.mime.includes('svg') ? 'svg' : a.mime.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov') || 'bin'
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset'
  return `${slug}-${a.id.slice(0, 6)}.${ext}`
}

// ---------- Icons (inline, 16px grid) ----------

const paths: Record<string, ReactNode> = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  star: <path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z" />,
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  pause: <path d="M5 3.5v9M11 3.5v9" />,
  plus: <path d="M8 3v10M3 8h10" />,
  download: <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  left: <path d="M10 3L5 8l5 5" />,
  right: <path d="M6 3l5 5-5 5" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  edit: <path d="M3 13l.6-2.8L10.8 3 13 5.2 5.8 12.4zM9.5 4.3l2.2 2.2" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5" />,
  film: <path d="M2.5 3.5h11v9h-11zM5 3.5v9M11 3.5v9M2.5 6.5H5M2.5 9.5H5M11 6.5h2.5M11 9.5h2.5" />,
  layers: <path d="M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3" />,
  copy: <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />,
  compare: <path d="M2.5 3.5h4.5v9H2.5zM9 3.5h4.5v9H9z" />,
  upload: <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13.5h10" />,
  spark: <path d="M8 2v4M8 10v4M2 8h4M10 8h4" />,
}

export function Icon({ name, size = 14 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

// ---------- Small controls ----------

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" />
      {label && <span>{label}</span>}
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  )
}

/** A text field that keeps local edits while focused and commits on blur. */
export function Draft({
  value,
  onCommit,
  multiline,
  className,
  placeholder,
  label,
  rows,
}: {
  value: string
  onCommit: (v: string) => void
  multiline?: boolean
  className?: string
  placeholder?: string
  label: string
  rows?: number
}) {
  const [v, setV] = useState(value)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setV(value)
  }, [value])
  const commit = () => {
    if (dirty.current && v !== value) onCommit(v)
    dirty.current = false
  }
  const props = {
    value: v,
    className: `draft ${className ?? ''}`,
    placeholder,
    'aria-label': label,
    onBlur: commit,
  }
  return multiline ? (
    <textarea
      {...props}
      rows={rows ?? 3}
      onChange={(e) => {
        dirty.current = true
        setV(e.target.value)
      }}
    />
  ) : (
    <input
      {...props}
      onChange={(e) => {
        dirty.current = true
        setV(e.target.value)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

// ---------- Media ----------

export function Media({ asset, full, controls }: { asset: Asset; full?: boolean; controls?: boolean }) {
  // Dry-run placeholders are SVG images even when they stand in for a video.
  if (asset.kind === 'video' && !asset.dryRun && asset.mime.startsWith('video/')) {
    return <video className="media" src={asset.url} controls={controls} muted={!controls} playsInline preload="metadata" loop={!controls} />
  }
  return <img className="media" src={asset.url} alt={asset.prompt.slice(0, 120)} loading={full ? 'eager' : 'lazy'} />
}

export function AssetBadges({ asset }: { asset: Asset }) {
  return (
    <span className="badges">
      {asset.dryRun && <span className="badge dry">Dry run</span>}
      {asset.kind === 'video' && <span className="badge">Video</span>}
      {asset.status === 'approved' && <span className="badge ok">Approved</span>}
      {asset.status === 'rejected' && <span className="badge bad">Rejected</span>}
      {asset.preferred && <span className="badge pref">Preferred</span>}
    </span>
  )
}

// ---------- Markdown (headings, lists, paragraphs, bold, italic) ----------

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
    if (list) {
      const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    }
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    const li = line.match(/^([-*]|\d+[.)])\s+(.*)$/)
    if (!line) flush()
    else if (h) {
      flush()
      const level = h[1].length
      blocks.push(level === 1 ? <h2 key={blocks.length}>{inline(h[2])}</h2> : level === 2 ? <h3 key={blocks.length}>{inline(h[2])}</h3> : <h4 key={blocks.length}>{inline(h[2])}</h4>)
    } else if (li) {
      if (para.length) flush()
      const ordered = /\d/.test(li[1])
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push(li[2])
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return <div className="md">{blocks}</div>
}

// ---------- Run dialog: the budget approval gate for every spend ----------

export function RunDialog({ project, status, preset, onClose, onDone }: { project: ProjectView; status: StudioStatus; preset: RunLine[]; onClose: () => void; onDone: (p: ProjectView) => void }) {
  const items = project.plan?.items ?? []
  const presetById = useMemo(() => new Map(preset.map((l) => [l.itemId, l])), [preset])
  const [checked, setChecked] = useState<Set<string>>(() => {
    if (preset.length) return new Set(preset.map((l) => l.itemId))
    const busy = new Set(project.jobs.filter(isActive).map((j) => j.itemId))
    const done = new Set(project.assets.filter((a) => a.origin === 'generated').map((a) => a.itemId))
    return new Set(items.filter((i) => i.kind === 'image' && !busy.has(i.id) && !done.has(i.id)).map((i) => i.id))
  })
  const initialCap = project.approvedBudgetUsd ?? project.maxBudgetUsd
  const [cap, setCap] = useState(initialCap !== null ? String(initialCap) : '')
  const capTouched = useRef(initialCap !== null)
  const [acceptUnknown, setAcceptUnknown] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const lines: RunLine[] = useMemo(() => items.filter((i) => checked.has(i.id)).map((i) => presetById.get(i.id) ?? { itemId: i.id }), [items, checked, presetById])
  const linesKey = JSON.stringify(lines)
  const capNum = cap.trim() === '' ? undefined : Number(cap)
  const capValid = capNum !== undefined && Number.isFinite(capNum) && capNum >= 0

  useEffect(() => {
    let stale = false
    const t = setTimeout(() => {
      api
        .quote(project.id, { lines: JSON.parse(linesKey) as RunLine[], budgetUsd: capValid ? capNum : undefined, acceptUnknownCost: acceptUnknown, idempotencyKey: 'quote' })
        .then((q) => {
          if (stale) return
          setQuote(q)
          setQuoteError('')
          if (!capTouched.current && q.afterUsd > 0) {
            capTouched.current = true
            setCap(String(Math.max(1, Math.ceil(q.afterUsd * 1.2))))
          }
        })
        .catch((e) => !stale && setQuoteError(errorText(e)))
    }, 220)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [project.id, linesKey, capNum, capValid, acceptUnknown])

  const live = quote ? quote.live : project.live
  const lineById = new Map((quote?.lines ?? []).map((l) => [l.itemId, l]))
  const needsUnknown = (quote?.unknownLines ?? 0) > 0
  const over = quote && capValid && quote.afterUsd > (capNum as number) + 1e-9
  const blocked = !quote || lines.length === 0 || !capValid || quote.problems.length > 0 || (needsUnknown && !acceptUnknown) || sending
  const pct = (n: number) => (capValid && (capNum as number) > 0 ? Math.min(100, (n / (capNum as number)) * 100) : 0)

  const confirm = async () => {
    setSending(true)
    setError('')
    try {
      const p = await api.run(project.id, { lines, budgetUsd: capNum, acceptUnknownCost: acceptUnknown, idempotencyKey: crypto.randomUUID() })
      onDone(p)
    } catch (e) {
      setError(errorText(e))
      setSending(false)
    }
  }

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const modelLabel = (id: string) => status.models.find((m) => m.id === id)?.label ?? id

  return (
    <Dialog
      title="Approve production"
      wide
      onClose={onClose}
      footer={
        <>
          <span className={`run-mode ${live ? 'live' : ''}`}>{live ? 'LIVE · This will charge your fal.ai account' : 'DRY RUN · No charges: placeholders only'}</span>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`btn ${live ? 'accent' : 'primary'}`} disabled={blocked} onClick={confirm}>
            {sending ? 'Sending…' : live ? `Approve ${quote ? usd(quote.totalUsd) : ''} and produce` : 'Run dry'}
          </button>
        </>
      }
    >
      <div className="run-list">
        {items.length === 0 && <p className="muted">There is no production plan yet.</p>}
        {items.map((it) => {
          const on = checked.has(it.id)
          const q = lineById.get(it.id)
          const pl = presetById.get(it.id)
          return (
            <label key={it.id} className={`run-line ${on ? 'on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(it.id)} />
              <span className="run-line-main">
                <span className="run-title">{it.title}</span>
                <span className="run-sub">
                  {modelLabel(it.modelId)} · {it.kind === 'video' ? `${it.durationSec}s` : `${pl?.count ?? q?.count ?? it.variations} image${(pl?.count ?? q?.count ?? it.variations) === 1 ? '' : 's'}`} · {it.aspect}
                  {pl?.fromAssetId && ' · variations of a selected image'}
                  {pl?.prompt && ' · revised prompt'}
                </span>
                {it.kind === 'video' && <span className="run-note">Waits for an approved keyframe before it is submitted.</span>}
                {on && q && <span className="run-basis">{q.estimate.basis}</span>}
              </span>
              <span className={`run-cost num ${on && q && q.estimate.usd === null ? 'unknown' : ''}`}>{on ? (q ? estimateLabel(q.estimate) : '…') : ''}</span>
            </label>
          )
        })}
      </div>

      <div className="run-summary">
        <div className="run-row">
          <span>This run</span>
          <span className="num">
            {quote ? usd(quote.totalUsd) : '…'}
            {needsUnknown && ` + ${quote?.unknownLines} unknown`}
          </span>
        </div>
        <div className="run-row">
          <span>Committed so far</span>
          <span className="num">{quote ? usd(quote.committedUsd) : usd(project.costs.committedUsd)}</span>
        </div>
        <div className="run-row strong">
          <span>After this run</span>
          <span className={`num ${over ? 'bad-text' : ''}`}>{quote ? usd(quote.afterUsd) : '…'}</span>
        </div>
        <div className="run-row">
          <label htmlFor="run-cap">Budget cap (hard limit, USD)</label>
          <input
            id="run-cap"
            className="input num cap"
            inputMode="decimal"
            value={cap}
            placeholder="0.00"
            onChange={(e) => {
              capTouched.current = true
              setCap(e.target.value)
            }}
          />
        </div>
        <div className={`meter ${over ? 'over' : ''}`} aria-hidden="true">
          <span className="meter-spent" style={{ width: `${pct(quote?.committedUsd ?? 0)}%` }} />
          <span className="meter-new" style={{ width: `${Math.max(0, pct(quote?.afterUsd ?? 0) - pct(quote?.committedUsd ?? 0))}%` }} />
        </div>
        {!capValid && <p className="bad-text small">Enter the budget cap you approve for this campaign.</p>}
        {needsUnknown && (
          <label className="check warn">
            <input type="checkbox" checked={acceptUnknown} onChange={(e) => setAcceptUnknown(e.target.checked)} />
            <span>I accept jobs with unknown cost ({quote?.unknownLines}). Their price could not be established, so they are not counted against the cap.</span>
          </label>
        )}
        {quote?.problems.map((p, i) => (
          <p key={i} className="bad-text small">
            {p}
          </p>
        ))}
        {quoteError && <p className="bad-text small">{quoteError}</p>}
        {error && <p className="bad-text small">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- Asset viewer (lightbox) ----------

export function AssetViewer({ ctx, assetId, onNavigate, onClose }: { ctx: Ctx; assetId: string; onNavigate: (id: string) => void; onClose: () => void }) {
  const { project, status } = ctx
  const list = useMemo(() => project.assets.filter((a) => a.origin !== 'reference').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [project.assets])
  const index = list.findIndex((a) => a.id === assetId)
  const asset = index >= 0 ? list[index] : project.assets.find((a) => a.id === assetId)
  const [revising, setRevising] = useState(false)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    setRevising(false)
  }, [assetId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(list[index - 1].id)
      if (e.key === 'ArrowRight' && index >= 0 && index < list.length - 1) onNavigate(list[index + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, list, onClose, onNavigate])

  if (!asset) return null
  const item: PlanItem | undefined = project.plan?.items.find((i) => i.id === asset.itemId)
  const job = project.jobs.find((j) => j.id === asset.jobId)
  const title = item?.title ?? (asset.origin === 'assembled' ? 'Assembled film' : asset.origin === 'reference' ? 'Reference' : 'Asset')
  const history = item ? outputsOf(project, item.id).filter((a) => a.id !== asset.id) : []
  const model = status.models.find((m) => m.id === asset.modelId)
  const patch = (p: { status?: Asset['status']; preferred?: boolean }) => ctx.act(() => api.patchAsset(project.id, asset.id, p))
  const isImage = asset.kind === 'image'

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button type="button" className="viewer-nav prev" onClick={() => onNavigate(list[index - 1].id)} aria-label="Previous">
            <Icon name="left" size={18} />
          </button>
        )}
        <Media asset={asset} full controls />
        {index >= 0 && index < list.length - 1 && (
          <button type="button" className="viewer-nav next" onClick={() => onNavigate(list[index + 1].id)} aria-label="Next">
            <Icon name="right" size={18} />
          </button>
        )}
      </div>
      <aside className="viewer-side">
        <header>
          <div>
            <h2 className="display">{title}</h2>
            <AssetBadges asset={asset} />
          </div>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        {asset.dryRun && <p className="note">Dry-run placeholder. This is not a real generation and nothing was charged.</p>}

        <div className="viewer-actions">
          <button type="button" className={`btn ${asset.status === 'approved' ? 'on' : ''}`} onClick={() => patch({ status: asset.status === 'approved' ? 'new' : 'approved' })}>
            <Icon name="check" /> {asset.status === 'approved' ? 'Approved' : 'Approve'}
          </button>
          <button type="button" className={`btn ${asset.status === 'rejected' ? 'on bad' : ''}`} onClick={() => patch({ status: asset.status === 'rejected' ? 'new' : 'rejected' })}>
            <Icon name="x" /> {asset.status === 'rejected' ? 'Rejected' : 'Reject'}
          </button>
          <button type="button" className={`btn ${asset.preferred ? 'on' : ''}`} onClick={() => patch({ preferred: !asset.preferred })}>
            <Icon name="star" /> {asset.preferred ? 'Preferred' : 'Prefer'}
          </button>
          <a className="btn" href={asset.url} download={fileName(asset, title)}>
            <Icon name="download" /> Download
          </a>
        </div>

        {item && (
          <div className="viewer-actions">
            {isImage && (
              <button type="button" className="btn" onClick={() => ctx.openRun([{ itemId: item.id, fromAssetId: asset.id }])}>
                <Icon name="layers" /> Make variations
              </button>
            )}
            {isImage && (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  if (await ctx.act(() => api.animate(project.id, asset.id))) {
                    onClose()
                    ctx.go('production')
                  }
                }}
              >
                <Icon name="film" /> Animate
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPrompt(asset.prompt || item.prompt)
                setRevising((v) => !v)
              }}
            >
              <Icon name="refresh" /> Regenerate with revised prompt
            </button>
          </div>
        )}

        {revising && item && (
          <div className="viewer-revise">
            <textarea className="input" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Revised prompt" />
            <button type="button" className="btn primary" disabled={!prompt.trim()} onClick={() => ctx.openRun([{ itemId: item.id, prompt: prompt.trim() }])}>
              Review cost and regenerate
            </button>
          </div>
        )}

        <dl className="facts">
          <dt>Prompt</dt>
          <dd className="prompt-text">{asset.prompt || '—'}</dd>
          <dt>Model</dt>
          <dd>{model?.label ?? (asset.modelId || '—')}</dd>
          {job && (
            <>
              <dt>Cost</dt>
              <dd className="num">
                {job.dryRun ? 'Dry run · $0.00 charged' : job.actualUsd !== undefined ? `${usd(job.actualUsd)} actual` : `${estimateLabel(job.estimate)} estimated`}
                {!job.dryRun && <span className="muted"> · {job.estimate.basis}</span>}
              </dd>
              <dt>Settings</dt>
              <dd>
                {job.aspect} · {job.resolution}
                {job.kind === 'video' ? ` · ${job.durationSec}s` : ` · ${job.count} per run`}
              </dd>
            </>
          )}
          <dt>Created</dt>
          <dd>{new Date(asset.createdAt).toLocaleString()}</dd>
        </dl>

        {history.length > 0 && (
          <div className="viewer-history">
            <h3>Other outputs of this item</h3>
            <div className="thumbs">
              {history.map((a) => (
                <button type="button" key={a.id} className={`thumb ${a.status}`} onClick={() => onNavigate(a.id)} aria-label="Open output">
                  <Media asset={a} />
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
