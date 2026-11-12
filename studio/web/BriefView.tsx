// Brief → concepts → direction → plan summary, with the conversation alongside.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ASPECTS } from '../shared/types.ts'
import type { Brief, Concept, NewProject, ProjectView, QualityMode, StudioStatus } from '../shared/types.ts'
import { api } from './api.ts'
import { errorText, Icon, Segmented, Spinner, usd } from './parts.tsx'
import type { Ctx } from './parts.tsx'

const MODES: { value: QualityMode; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'premium', label: 'Premium' },
]

const MODE_NOTE: Record<QualityMode, string> = {
  economy: 'Cheapest models. Best for exploring.',
  balanced: 'Quality weighed against cost.',
  premium: 'Final production quality first.',
}

interface Fields {
  text: string
  brand: string
  product: string
  audience: string
  objective: string
  deliverables: string
  aesthetic: string
  aspects: string[]
  maxBudget: string
  mode: QualityMode
}

const emptyFields: Fields = { text: '', brand: '', product: '', audience: '', objective: '', deliverables: '', aesthetic: '', aspects: [], maxBudget: '', mode: 'balanced' }

function toBrief(f: Fields): Omit<Brief, 'referenceAssetIds'> {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined)
  return {
    text: f.text.trim(),
    brand: opt(f.brand),
    product: opt(f.product),
    audience: opt(f.audience),
    objective: opt(f.objective),
    deliverables: opt(f.deliverables),
    aesthetic: opt(f.aesthetic),
    aspects: f.aspects.length ? f.aspects : undefined,
  }
}

function budgetOf(f: Fields): number | null {
  const n = Number(f.maxBudget)
  return f.maxBudget.trim() && Number.isFinite(n) && n > 0 ? n : null
}

function DetailFields({ f, set }: { f: Fields; set: (patch: Partial<Fields>) => void }) {
  const field = (key: 'brand' | 'product' | 'audience' | 'objective' | 'deliverables' | 'aesthetic', label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={f[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  )
  return (
    <div className="details-grid">
      {field('brand', 'Brand', 'Name and a line about it')}
      {field('product', 'Product or service', 'What is being launched')}
      {field('audience', 'Audience', 'Who it is for')}
      {field('objective', 'Creative objective', 'What the work must achieve')}
      {field('deliverables', 'Deliverables', 'Key visuals, social ads, a 15-second film')}
      {field('aesthetic', 'Preferred aesthetic', 'Cinematic, restrained, warm')}
      <div className="field span">
        <span>Aspect ratios</span>
        <div className="chips">
          {ASPECTS.map((a) => {
            const on = f.aspects.includes(a)
            return (
              <button key={a} type="button" className={`chip-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ aspects: on ? f.aspects.filter((x) => x !== a) : [...f.aspects, a] })}>
                {a}
              </button>
            )
          })}
        </div>
      </div>
      <label className="field">
        <span>Maximum production budget (USD)</span>
        <input className="input num" inputMode="decimal" value={f.maxBudget} placeholder="No limit set" onChange={(e) => set({ maxBudget: e.target.value })} />
      </label>
      <div className="field">
        <span>Production mode</span>
        <Segmented label="Production mode" value={f.mode} options={MODES} onChange={(mode) => set({ mode })} />
        <span className="hint">{MODE_NOTE[f.mode]}</span>
      </div>
    </div>
  )
}

// ---------- New campaign ----------

export function BriefComposer({ status, onCreated }: { status: StudioStatus; onCreated: (p: ProjectView) => void }) {
  const [f, setF] = useState<Fields>(emptyFields)
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<{ file: File; url: string }[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }))

  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(() => () => filesRef.current.forEach((x) => URL.revokeObjectURL(x.url)), [])

  const submit = async () => {
    if (!f.text.trim() || busy) return
    setError('')
    setBusy('Creating the campaign')
    let p: ProjectView
    try {
      const body: NewProject = { brief: toBrief(f), mode: f.mode, maxBudgetUsd: budgetOf(f) }
      p = await api.create(body)
    } catch (e) {
      setError(errorText(e))
      setBusy('')
      return
    }
    // The campaign exists from here on: open it even if a later step fails.
    try {
      for (const x of files) {
        setBusy('Uploading references')
        p = await api.addReference(p.id, x.file)
      }
      setBusy('Briefing the director')
      p = await api.concepts(p.id)
    } catch {
      /* the brief view shows the state and lets the user retry */
    }
    onCreated(p)
  }

  return (
    <section className="composer">
      <h1 className="display xl">What are we making?</h1>
      <p className="muted lead">Write the brief the way you would say it. Everything else is optional.</p>
      <textarea
        className="input brief-text"
        rows={7}
        autoFocus
        value={f.text}
        placeholder="A premium launch campaign for a fictional luxury automotive brand. Cinematic, futuristic, emotional. Key visuals, social ads, and a 15-second film."
        onChange={(e) => set({ text: e.target.value })}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
      />

      <button type="button" className="disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron' : 'right'} /> Details
        <span className="muted"> · brand, audience, deliverables, budget, mode, references</span>
      </button>
      {open && (
        <>
          <DetailFields f={f} set={set} />
          <div className="field span">
            <span>Visual references and brand assets</span>
            <div className="refs">
              {files.map((x, i) => (
                <span className="ref" key={x.url}>
                  <img src={x.url} alt="" />
                  <button type="button" className="ref-x" aria-label="Remove reference" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              <button type="button" className="ref add" onClick={() => input.current?.click()} aria-label="Add reference image">
                <Icon name="upload" size={16} />
              </button>
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []).map((file) => ({ file, url: URL.createObjectURL(file) }))
                  setFiles((l) => [...l, ...picked])
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </>
      )}

      {error && <p className="bad-text">{error}</p>}
      <div className="composer-foot">
        <span className="muted small">
          {status.anthropic ? `Directions are written by Claude (${status.claudeModel}).` : 'No ANTHROPIC_API_KEY on the server: directions come from the built-in sample director.'} No media is generated and nothing is spent on fal.ai at this stage.
        </span>
        <button type="button" className="btn primary large" disabled={!f.text.trim() || !!busy} onClick={submit}>
          {busy ? <Spinner label={busy} /> : 'Propose directions'}
        </button>
      </div>
    </section>
  )
}

// ---------- Existing campaign ----------

export function BriefView({ ctx }: { ctx: Ctx }) {
  const { project, act } = ctx
  const [reconsider, setReconsider] = useState(false)
  const latestRound = Math.max(0, ...project.concepts.map((c) => c.round))
  const showConcepts = project.concepts.length > 0 && (!project.direction || reconsider)
  const task = project.agentTask

  return (
    <main className="page brief-layout">
      <div className="brief-main">
        <BriefCard ctx={ctx} />

        {project.concepts.length === 0 && !task && (
          <section className="block center">
            <p className="muted">The director has not proposed directions yet.</p>
            <button type="button" className="btn primary" onClick={() => act(() => api.concepts(project.id))}>
              Propose three directions
            </button>
          </section>
        )}

        {task === 'concepts' && <Working title="Reading the brief" text="The director is developing three distinct creative directions. No media is being generated." />}

        {showConcepts && task !== 'concepts' && <Concepts ctx={ctx} round={latestRound} onChosen={() => setReconsider(false)} />}

        {task === 'direction' && <Working title="Writing the direction" text="The director is refining the selected direction." />}

        {project.direction && task !== 'direction' && <DirectionCard ctx={ctx} reconsider={reconsider} onReconsider={() => setReconsider((v) => !v)} />}

        {task === 'plan' && <Working title="Planning the production" text="Shots, prompts, models, dependencies and cost per asset. Nothing is generated until you approve a budget." />}

        {project.plan && task !== 'plan' && <PlanSummary ctx={ctx} />}
      </div>

      <aside className="brief-log" aria-label="Conversation">
        <h3>Conversation</h3>
        {project.log.length === 0 && <p className="muted small">Nothing yet.</p>}
        <ol>
          {project.log.map((e) => (
            <li key={e.id} className={`log ${e.role}`}>
              <span className="log-role">{e.role === 'user' ? 'You' : e.role === 'director' ? 'Director' : 'Studio'}</span>
              <p>{e.text}</p>
              <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  )
}

function Working({ title, text }: { title: string; text: string }) {
  return (
    <section className="block working" role="status">
      <span className="working-bar" />
      <h2 className="display">{title}</h2>
      <p className="muted">{text}</p>
    </section>
  )
}

function BriefCard({ ctx }: { ctx: Ctx }) {
  const { project, act } = ctx
  const b = project.brief
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState<Fields>(emptyFields)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const refs = project.assets.filter((a) => b.referenceAssetIds.includes(a.id))

  const begin = () => {
    setF({
      text: b.text,
      brand: b.brand ?? '',
      product: b.product ?? '',
      audience: b.audience ?? '',
      objective: b.objective ?? '',
      deliverables: b.deliverables ?? '',
      aesthetic: b.aesthetic ?? '',
      aspects: b.aspects ?? [],
      maxBudget: project.maxBudgetUsd !== null ? String(project.maxBudgetUsd) : '',
      mode: project.mode,
    })
    setEditing(true)
  }

  const save = async () => {
    const brief = toBrief(f)
    // Send empty strings for cleared fields so the server can drop them.
    const full = { ...brief, brand: f.brand.trim(), product: f.product.trim(), audience: f.audience.trim(), objective: f.objective.trim(), deliverables: f.deliverables.trim(), aesthetic: f.aesthetic.trim(), aspects: f.aspects }
    if (await act(() => api.patch(project.id, { brief: full, mode: f.mode, maxBudgetUsd: budgetOf(f) }))) setEditing(false)
  }

  const upload = async (list: File[]) => {
    setUploading(true)
    for (const file of list) await act(() => api.addReference(project.id, file))
    setUploading(false)
  }

  const facts: [string, string | undefined][] = [
    ['Brand', b.brand],
    ['Product', b.product],
    ['Audience', b.audience],
    ['Objective', b.objective],
    ['Deliverables', b.deliverables],
    ['Aesthetic', b.aesthetic],
    ['Aspect ratios', b.aspects?.join(', ')],
    ['Maximum budget', project.maxBudgetUsd !== null ? usd(project.maxBudgetUsd) : undefined],
    ['Mode', project.mode[0].toUpperCase() + project.mode.slice(1)],
  ]

  return (
    <section className="block">
      <div className="block-head">
        <span className="eyebrow">Brief</span>
        {!editing && (
          <button type="button" className="btn ghost small" onClick={begin}>
            <Icon name="edit" /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea className="input brief-text" rows={5} value={f.text} onChange={(e) => setF((x) => ({ ...x, text: e.target.value }))} aria-label="Brief" />
          <DetailFields f={f} set={(patch) => setF((x) => ({ ...x, ...patch }))} />
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={!f.text.trim()} onClick={save}>
              Save brief
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="brief-quote">{b.text}</p>
          <dl className="facts inline">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </>
      )}
      <div className="field span">
        <span>References</span>
        <div className="refs">
          {refs.map((a) => (
            <span className="ref" key={a.id}>
              <img src={a.url} alt="Reference" />
              <button type="button" className="ref-x" aria-label="Remove reference" onClick={() => act(() => api.removeReference(project.id, a.id))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          <button type="button" className="ref add" disabled={uploading} onClick={() => input.current?.click()} aria-label="Add reference image">
            {uploading ? <Spinner /> : <Icon name="upload" size={16} />}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const list = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (list.length) upload(list)
            }}
          />
        </div>
      </div>
    </section>
  )
}

function Palette({ palette }: { palette: Concept['palette'] }) {
  return (
    <div className="palette">
      {palette.map((c, i) => (
        <span key={i} className="swatch" title={`${c.name} ${c.hex}`}>
          <span className="swatch-color" style={{ background: c.hex }} />
          <span className="swatch-name">{c.name}</span>
          <span className="swatch-hex num">{c.hex}</span>
        </span>
      ))}
    </div>
  )
}

function ConceptBody({ c }: { c: Concept }) {
  return (
    <>
      <p className="concept-idea">{c.idea}</p>
      <p className="concept-message">“{c.message}”</p>
      <Palette palette={c.palette} />
      <dl className="facts">
        <dt>Visual language</dt>
        <dd>{c.visualLanguage}</dd>
        <dt>Art direction</dt>
        <dd>{c.artDirection}</dd>
        <dt>Lighting and cinematography</dt>
        <dd>{c.cinematography}</dd>
        <dt>Suggested deliverables</dt>
        <dd>
          <ul className="plain">
            {c.deliverables.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </dd>
        <dt>Production approach</dt>
        <dd>{c.productionApproach}</dd>
      </dl>
    </>
  )
}

function Concepts({ ctx, round, onChosen }: { ctx: Ctx; round: number; onChosen: () => void }) {
  const { project, act } = ctx
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const current = project.concepts.filter((c) => c.round === round)
  const earlier = useMemo(() => {
    const rounds = new Map<number, Concept[]>()
    for (const c of project.concepts) if (c.round !== round) rounds.set(c.round, [...(rounds.get(c.round) ?? []), c])
    return [...rounds.entries()].sort((a, b) => b[0] - a[0])
  }, [project.concepts, round])

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const choose = async () => {
    setBusy(true)
    if (await act(() => api.direction(project.id, { conceptIds: selected, note: note.trim() || undefined }))) {
      setSelected([])
      setNote('')
      onChosen()
    }
    setBusy(false)
  }

  const card = (c: Concept) => {
    const on = selected.includes(c.id)
    return (
      <article key={c.id} className={`concept ${on ? 'on' : ''}`}>
        <header>
          <h3 className="display">{c.name}</h3>
          <button type="button" className={`btn small ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(c.id)}>
            {on ? (
              <>
                <Icon name="check" /> Selected
              </>
            ) : (
              'Select'
            )}
          </button>
        </header>
        <ConceptBody c={c} />
      </article>
    )
  }

  return (
    <section className="block bare">
      <div className="block-head">
        <span className="eyebrow">Creative directions{round > 1 ? ` · round ${round}` : ''}</span>
        <span className="muted small">Nothing has been spent on media. These are ideas only.</span>
      </div>
      <div className="concept-grid">{current.map(card)}</div>

      <div className="decide">
        <input className="input" value={note} placeholder={selected.length > 1 ? 'How to combine them (optional)' : 'Refine it: warmer, no neon, more product (optional)'} onChange={(e) => setNote(e.target.value)} aria-label="Refinement note" />
        <button type="button" className="btn primary" disabled={selected.length === 0 || busy || !!project.agentTask} onClick={choose}>
          {selected.length > 1 ? `Combine ${selected.length} selected` : note.trim() ? 'Choose and refine' : 'Choose this direction'}
        </button>
      </div>
      <div className="decide quiet">
        <input className="input" value={feedback} placeholder="What should be different next time (optional)" onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback for new directions" />
        <button
          type="button"
          className="btn"
          disabled={!!project.agentTask}
          onClick={async () => {
            if (await act(() => api.concepts(project.id, feedback.trim() || undefined))) {
              setFeedback('')
              setSelected([])
            }
          }}
        >
          <Icon name="refresh" /> Propose three new directions
        </button>
      </div>

      {earlier.length > 0 && (
        <details className="earlier">
          <summary>Earlier rounds ({earlier.reduce((n, [, l]) => n + l.length, 0)} directions)</summary>
          {earlier.map(([r, list]) => (
            <div key={r}>
              <span className="eyebrow">Round {r}</span>
              <div className="concept-grid">{list.map(card)}</div>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

function DirectionCard({ ctx, reconsider, onReconsider }: { ctx: Ctx; reconsider: boolean; onReconsider: () => void }) {
  const { project, act } = ctx
  const d = project.direction as Concept
  const [draft, setDraft] = useState<Concept | null>(null)
  const [note, setNote] = useState('')

  const text = (key: 'name' | 'idea' | 'message' | 'visualLanguage' | 'artDirection' | 'cinematography' | 'productionApproach', label: string, rows = 2) =>
    draft && (
      <label className="field span">
        <span>{label}</span>
        {rows === 1 ? (
          <input className="input" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        ) : (
          <textarea className="input" rows={rows} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        )}
      </label>
    )

  return (
    <section className="block direction">
      <div className="block-head">
        <span className="eyebrow">Approved direction</span>
        <span className="row">
          {!draft && project.concepts.length > 0 && (
            <button type="button" className="btn ghost small" onClick={onReconsider}>
              {reconsider ? 'Hide directions' : 'Reconsider directions'}
            </button>
          )}
          {!draft && (
            <button type="button" className="btn ghost small" onClick={() => setDraft({ ...d, palette: d.palette.map((c) => ({ ...c })), deliverables: [...d.deliverables] })}>
              <Icon name="edit" /> Edit
            </button>
          )}
        </span>
      </div>

      {draft ? (
        <div className="details-grid">
          {text('name', 'Concept name', 1)}
          {text('idea', 'Core idea', 3)}
          {text('message', 'Key campaign message', 1)}
          {text('visualLanguage', 'Visual language')}
          {text('artDirection', 'Art direction')}
          {text('cinematography', 'Lighting and cinematography')}
          <label className="field span">
            <span>Deliverables (one per line)</span>
            <textarea className="input" rows={4} value={draft.deliverables.join('\n')} onChange={(e) => setDraft({ ...draft, deliverables: e.target.value.split('\n') })} />
          </label>
          {text('productionApproach', 'Production approach')}
          <div className="field span">
            <span>Palette</span>
            <div className="palette-edit">
              {draft.palette.map((c, i) => (
                <span key={i} className="palette-row">
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#888888'} aria-label="Colour" onChange={(e) => setDraft({ ...draft, palette: draft.palette.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
                  <input className="input" value={c.name} aria-label="Colour name" onChange={(e) => setDraft({ ...draft, palette: draft.palette.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <button type="button" className="btn ghost icon" aria-label="Remove colour" onClick={() => setDraft({ ...draft, palette: draft.palette.filter((_, j) => j !== i) })}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
              {draft.palette.length < 6 && (
                <button type="button" className="btn small" onClick={() => setDraft({ ...draft, palette: [...draft.palette, { name: 'New colour', hex: '#888888' }] })}>
                  <Icon name="plus" /> Add colour
                </button>
              )}
            </div>
          </div>
          <div className="row end span">
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!draft.name.trim()}
              onClick={async () => {
                const clean = { ...draft, deliverables: draft.deliverables.map((x) => x.trim()).filter(Boolean) }
                if (await act(() => api.putDirection(project.id, clean))) setDraft(null)
              }}
            >
              Save direction
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="display xl">{d.name}</h2>
          <ConceptBody c={d} />
        </>
      )}

      {!draft && !project.plan && (
        <div className="decide">
          <input className="input" value={note} placeholder="Notes for the plan: fewer social formats, one hero film (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Plan note" />
          <button
            type="button"
            className="btn primary"
            disabled={!!project.agentTask}
            onClick={async () => {
              if (await act(() => api.plan(project.id, note.trim() || undefined))) setNote('')
            }}
          >
            Build production plan
          </button>
        </div>
      )}
    </section>
  )
}

function PlanSummary({ ctx }: { ctx: Ctx }) {
  const { project, act, go } = ctx
  const plan = project.plan!
  const [note, setNote] = useState('')
  const [replan, setReplan] = useState(false)
  const images = plan.items.filter((i) => i.kind === 'image').length
  const videos = plan.items.length - images
  const c = project.costs
  return (
    <section className="block">
      <div className="block-head">
        <span className="eyebrow">Production plan</span>
        <span className="muted small num">
          {images} image item{images === 1 ? '' : 's'} · {videos} video shot{videos === 1 ? '' : 's'} · estimate {usd(c.planUsd)}
          {c.planUnknownItems > 0 && ` + ${c.planUnknownItems} unknown`}
        </span>
      </div>
      <h2 className="display xl">{plan.campaignTitle}</h2>
      <p>{plan.summary}</p>
      <dl className="facts">
        <dt>Continuity</dt>
        <dd>{plan.continuity}</dd>
      </dl>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => go('production')}>
          Open production board
        </button>
        <button type="button" className="btn" onClick={() => setReplan((v) => !v)}>
          Re-plan with a note
        </button>
      </div>
      {replan && (
        <div className="decide">
          <input className="input" value={note} autoFocus placeholder="What should change in the plan" onChange={(e) => setNote(e.target.value)} aria-label="Re-plan note" />
          <button
            type="button"
            className="btn"
            disabled={!note.trim() || !!project.agentTask}
            onClick={async () => {
              if (await act(() => api.plan(project.id, note.trim()))) {
                setNote('')
                setReplan(false)
              }
            }}
          >
            Re-plan
          </button>
        </div>
      )}
      {replan && <p className="muted small">Re-planning replaces the plan items. Generated and approved assets are kept.</p>}
    </section>
  )
}
