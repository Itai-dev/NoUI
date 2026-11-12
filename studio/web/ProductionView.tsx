// The production board: every planned asset as an editable card, grouped by deliverable type.
import { useState } from 'react'
import { GROUP_LABEL } from '../shared/types.ts'
import type { AssetGroup, Job, ModelInfo, PlanItem, QualityMode } from '../shared/types.ts'
import { api } from './api.ts'
import { Dialog, Draft, estimateLabel, Icon, isActive, JOB_LABEL, Media, outputsOf, priceLabel, Segmented, usd } from './parts.tsx'
import type { Ctx } from './parts.tsx'

const GROUPS: AssetGroup[] = ['key_visual', 'social', 'video_shot', 'supporting', 'final_video']
const MODES: { value: QualityMode; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'premium', label: 'Premium' },
]

export function ProductionView({ ctx }: { ctx: Ctx }) {
  const { project, status, act, go, openRun } = ctx
  const [confirmLive, setConfirmLive] = useState(false)
  const plan = project.plan
  const c = project.costs

  if (!plan)
    return (
      <main className="empty-page">
        <h1 className="display">No production plan yet.</h1>
        <p className="muted">Choose a direction in the brief, then ask the director for a plan.</p>
        <button type="button" className="btn primary" onClick={() => go('brief')}>
          Go to the brief
        </button>
      </main>
    )

  const active = project.jobs.filter(isActive).length

  return (
    <main className="page">
      <div className="board-head">
        <div>
          <span className="eyebrow">Production board</span>
          <h1 className="display xl">{plan.campaignTitle}</h1>
        </div>
        <div className="board-actions">
          {active > 0 && (
            <span className="pulse-chip">
              <span className="pulse" /> {active} job{active === 1 ? '' : 's'} active
            </span>
          )}
          <button type="button" className="btn" onClick={() => act(() => api.patch(project.id, { paused: !project.paused }))}>
            <Icon name={project.paused ? 'play' : 'pause'} /> {project.paused ? 'Resume' : 'Pause'}
          </button>
          <label className={`switch ${project.live ? 'live' : ''} ${!status.fal ? 'disabled' : ''}`} title={status.fal ? '' : 'Add FAL_KEY on the server to enable live production'}>
            <input
              type="checkbox"
              role="switch"
              checked={project.live}
              disabled={!status.fal}
              onChange={() => (project.live ? act(() => api.patch(project.id, { live: false })) : setConfirmLive(true))}
            />
            <span className="switch-track" />
            <span>{project.live ? 'Live' : 'Dry run'}</span>
          </label>
          <button type="button" className={`btn ${project.live ? 'accent' : 'primary'}`} onClick={() => openRun()}>
            Approve &amp; produce…
          </button>
        </div>
      </div>

      <div className="board-bar">
        <div className="bar-cell">
          <span className="label">Plan estimate</span>
          <span className="big num">
            {usd(c.planUsd)}
            {c.planUnknownItems > 0 && <span className="unknown-tag">+ {c.planUnknownItems} unknown</span>}
          </span>
          <span className="hint">One generation per item, current models.</span>
        </div>
        <div className="bar-cell">
          <span className="label">Mode</span>
          <Segmented label="Production mode" value={project.mode} options={MODES} onChange={(mode) => act(() => api.patch(project.id, { mode }))} />
          <span className="hint">Applies to new plans and new items. Existing cards keep their model.</span>
        </div>
        <div className="bar-cell modes">
          <span className="label">Same plan in each mode</span>
          <div className="mode-compare">
            {MODES.map((m) => {
              const v = c.planByMode[m.value]
              return (
                <span key={m.value} className={m.value === project.mode ? 'on' : ''}>
                  <span className="muted">{m.label}</span>
                  <span className="num">
                    {usd(v.usd)}
                    {v.unknownItems > 0 && <span className="unknown-tag">+{v.unknownItems}?</span>}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
        <div className="bar-cell">
          <span className="label">Budget</span>
          <span className="big num">
            {usd(c.committedUsd)} <span className="muted">/ {c.budgetUsd !== null ? usd(c.budgetUsd) : '—'}</span>
          </span>
          <span className="hint">{c.budgetUsd !== null ? `Spent ${usd(c.spentUsd)} · reserved ${usd(c.reservedUsd)}` : 'No budget approved yet. Nothing can run.'}</span>
        </div>
      </div>

      {project.paused && <p className="note">Production is paused. Waiting jobs stay reserved and will not be submitted until you resume.</p>}
      {status.pricing.error && <p className="note">Live pricing unavailable: {status.pricing.error}. Affected estimates are marked unknown and need explicit approval.</p>}
      {plan.continuity && (
        <p className="continuity">
          <span className="label">Continuity</span> {plan.continuity}
        </p>
      )}

      {GROUPS.map((g) => {
        const items = plan.items.filter((i) => i.group === g)
        if (g === 'final_video' && items.length === 0) return null
        return (
          <section key={g} className="group">
            <div className="group-head">
              <h2>
                {GROUP_LABEL[g]} <span className="muted num">{items.length}</span>
              </h2>
              {g !== 'final_video' && (
                <button type="button" className="btn ghost small" onClick={() => act(() => api.addItem(project.id, { group: g, kind: g === 'video_shot' ? 'video' : 'image', title: g === 'video_shot' ? 'New shot' : 'New visual' }))}>
                  <Icon name="plus" /> Add item
                </button>
              )}
            </div>
            {items.length === 0 ? <p className="muted small group-empty">Nothing planned here.</p> : <div className="card-grid">{items.map((it) => <ItemCard key={it.id} ctx={ctx} item={it} />)}</div>}
          </section>
        )
      })}

      {confirmLive && (
        <Dialog
          title="Switch to live production"
          onClose={() => setConfirmLive(false)}
          footer={
            <>
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={() => setConfirmLive(false)}>
                Stay in dry run
              </button>
              <button
                type="button"
                className="btn accent"
                onClick={async () => {
                  await act(() => api.patch(project.id, { live: true, confirmLive: true }))
                  setConfirmLive(false)
                }}
              >
                Go live
              </button>
            </>
          }
        >
          <p>In live mode, approved jobs are sent to fal.ai and charged to your fal.ai account.</p>
          <p className="muted">Switching does not start anything. Every run still shows its cost and needs your approval, and the server refuses any run that would pass the budget cap you approve.</p>
        </Dialog>
      )}
    </main>
  )
}

function ItemCard({ ctx, item }: { ctx: Ctx; item: PlanItem }) {
  const { project, status, act, openRun, openViewer } = ctx
  const [revise, setRevise] = useState(false)
  const [note, setNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAlt, setShowAlt] = useState(false)

  const models = status.models.filter((m) => m.kind === item.kind)
  const model: ModelInfo | undefined = status.models.find((m) => m.id === item.modelId)
  const cost = project.costs.items.find((x) => x.itemId === item.id)
  const jobs = project.jobs.filter((j) => j.itemId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const activeJob: Job | undefined = jobs.find(isActive)
  const lastJob: Job | undefined = jobs[0]
  const failed = !activeJob && lastJob && lastJob.status === 'failed' ? lastJob : undefined
  const outputs = outputsOf(project, item.id)
  const shown = [...outputs].sort((a, b) => Number(a.status === 'rejected') - Number(b.status === 'rejected')).slice(0, 4)
  const patch = (p: Partial<PlanItem>) => act(() => api.patchItem(project.id, item.id, p))
  const deps = item.dependsOn.map((id) => project.plan?.items.find((i) => i.id === id)?.title ?? 'a removed item')
  const pinned = item.pinnedAssetId ? project.assets.find((a) => a.id === item.pinnedAssetId) : undefined
  const hasRefs = project.brief.referenceAssetIds.length > 0
  const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list)
  const unknown = cost?.estimate.usd === null

  return (
    <article className={`card ${activeJob ? 'busy' : ''}`}>
      <div className={`card-media n${Math.min(shown.length, 4)}`}>
        {shown.length === 0 ? (
          <div className="card-empty">
            <span className="muted">{item.kind === 'video' ? 'Video shot' : 'Image'}</span>
            <span className="num">{item.aspect}</span>
          </div>
        ) : (
          shown.map((a) => (
            <button type="button" key={a.id} className={`tile ${a.status}`} onClick={() => openViewer(a.id)} aria-label={`Open output of ${item.title}`}>
              <Media asset={a} />
              {a.dryRun && <span className="badge dry">Dry run</span>}
              {a.status === 'approved' && <span className="tile-mark ok"><Icon name="check" size={12} /></span>}
              {a.preferred && <span className="tile-mark pref"><Icon name="star" size={12} /></span>}
            </button>
          ))
        )}
        {activeJob && <span className="shimmer" aria-hidden="true" />}
      </div>

      {activeJob && (
        <div className="job-line" role="status">
          <span className="pulse" />
          <span>
            {JOB_LABEL[activeJob.status]}
            {activeJob.waiting ? ` · ${activeJob.waiting}` : ''}
            {activeJob.dryRun ? ' · dry run' : ''}
          </span>
          <span className="grow" />
          <span className="num muted">{estimateLabel(activeJob.estimate)}</span>
          <button type="button" className="btn ghost small" onClick={() => act(() => api.cancelJob(project.id, activeJob.id))}>
            Cancel job
          </button>
        </div>
      )}
      {failed && (
        <div className="job-line failed" role="alert">
          <span>{failed.error || 'The generation failed.'}</span>
          <span className="grow" />
          <button type="button" className="btn small" onClick={() => openRun([{ itemId: item.id }])}>
            Retry
          </button>
        </div>
      )}

      <div className="card-body">
        <Draft className="card-title" label="Title" value={item.title} onCommit={(title) => patch({ title })} />
        <Draft className="card-purpose" label="Creative purpose" placeholder="Creative purpose" value={item.purpose} onCommit={(purpose) => patch({ purpose })} />
        <Draft className="card-desc" multiline rows={2} label="Visual description" placeholder="Visual description" value={item.description} onCommit={(description) => patch({ description })} />

        <label className="field">
          <span>Generation prompt</span>
          <Draft className="input prompt" multiline rows={5} label="Generation prompt" value={item.prompt} onCommit={(prompt) => patch({ prompt })} />
        </label>

        <label className="field">
          <span>Model</span>
          <select className="input" value={item.modelId} onChange={(e) => patch({ modelId: e.target.value, modelReason: '' })}>
            {!model && <option value={item.modelId}>{item.modelId} (unavailable)</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.tier} · {priceLabel(m)}
              </option>
            ))}
          </select>
          {item.modelReason ? <span className="hint">{item.modelReason}</span> : model ? <span className="hint">Your choice. {model.strengths}</span> : null}
        </label>

        <div className="controls">
          <label className="field">
            <span>Aspect</span>
            <select className="input" value={item.aspect} onChange={(e) => patch({ aspect: e.target.value })}>
              {withCurrent(model?.aspects ?? [], item.aspect).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Resolution</span>
            <select className="input" value={item.resolution} onChange={(e) => patch({ resolution: e.target.value })}>
              {withCurrent(model?.resolutions ?? [], item.resolution).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {item.kind === 'video' ? (
            <label className="field">
              <span>Seconds</span>
              <input
                className="input num"
                type="number"
                min={model?.duration?.[0] ?? 1}
                max={model?.duration?.[1] ?? 30}
                value={item.durationSec}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value))
                  const lo = model?.duration?.[0] ?? 1
                  const hi = model?.duration?.[1] ?? 30
                  if (Number.isFinite(n) && n >= lo && n <= hi) patch({ durationSec: n })
                }}
              />
            </label>
          ) : (
            <div className="field">
              <span>Variations</span>
              <div className="stepper">
                <button type="button" aria-label="Fewer variations" disabled={item.variations <= 1} onClick={() => patch({ variations: item.variations - 1 })}>
                  −
                </button>
                <span className="num">{item.variations}</span>
                <button type="button" aria-label="More variations" disabled={item.variations >= (model?.maxVariations ?? 4)} onClick={() => patch({ variations: item.variations + 1 })}>
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {!pinned && (
          <label className="field">
            <span>{item.kind === 'video' ? 'First frame (keyframe)' : 'Builds on'}</span>
            <select
              className="input"
              value={item.dependsOn[0] ?? ''}
              onChange={(e) => patch({ dependsOn: e.target.value ? [e.target.value] : [] })}
              aria-label={item.kind === 'video' ? 'Keyframe item' : 'Reference item'}
            >
              <option value="">{item.kind === 'video' ? 'Choose an image item' : 'Nothing: generated from the prompt alone'}</option>
              {(project.plan?.items ?? [])
                .filter((i) => i.kind === 'image' && i.id !== item.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} (approved output)
                  </option>
                ))}
            </select>
          </label>
        )}

        {(deps.length > 0 || pinned || hasRefs) && (
          <div className="deps">
            {pinned && (
              <button type="button" className="thumb pinned" onClick={() => openViewer(pinned.id)} aria-label="Open pinned keyframe">
                <Media asset={pinned} />
              </button>
            )}
            <span>
              {pinned ? 'Uses this pinned image as its reference.' : deps.length > 0 ? `Uses: ${deps.join(', ')} (approved output)` : ''}
              {item.kind === 'video' && !pinned && deps.length === 0 && <span className="bad-text">Needs a keyframe: link an image item or animate an approved image.</span>}
            </span>
            {hasRefs && (
              <label className="check">
                <input type="checkbox" checked={item.useBriefReferences} onChange={(e) => patch({ useBriefReferences: e.target.checked })} />
                <span>Use brief references</span>
              </label>
            )}
          </div>
        )}
        {item.kind === 'video' && !pinned && deps.length === 0 && !hasRefs && <p className="bad-text small">Needs a keyframe: animate an approved image from the Assets view.</p>}

        <div className="cost-line">
          <button type="button" className={`cost ${unknown ? 'unknown' : ''}`} aria-expanded={showAlt} onClick={() => setShowAlt((v) => !v)} title={cost?.estimate.basis}>
            <span className="num">{estimateLabel(cost?.estimate)}</span>
            <span className="muted"> per run</span>
            <Icon name="chevron" size={12} />
          </button>
          {unknown && <span className="badge warn">Unknown cost</span>}
        </div>
        {showAlt && cost && (
          <div className="alt">
            <p className="muted small">{cost.estimate.basis}</p>
            {MODES.map((m) => {
              const a = cost.alternatives[m.value]
              const label = status.models.find((x) => x.id === a.modelId)?.label ?? a.modelId
              return (
                <div key={m.value} className="alt-row">
                  <span className="muted">{m.label}</span>
                  <span>{label}</span>
                  <span className="num">{estimateLabel(a.estimate)}</span>
                  {a.modelId !== item.modelId ? (
                    <button type="button" className="btn ghost small" onClick={() => patch({ modelId: a.modelId, modelReason: '' })}>
                      Use
                    </button>
                  ) : (
                    <span className="muted small">current</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {revise && (
          <div className="revise">
            <input className="input" autoFocus value={note} placeholder="What should change: closer, dusk light, no people" onChange={(e) => setNote(e.target.value)} aria-label="Revision note" />
            <button
              type="button"
              className="btn"
              disabled={!note.trim() || !!project.agentTask}
              onClick={async () => {
                if (await act(() => api.revise(project.id, item.id, note.trim()))) {
                  setNote('')
                  setRevise(false)
                }
              }}
            >
              Rewrite prompt
            </button>
          </div>
        )}

        <div className="card-actions">
          <button type="button" className="btn primary small" disabled={!!activeJob} onClick={() => openRun([{ itemId: item.id }])}>
            {outputs.length ? 'Regenerate' : 'Generate'}
          </button>
          <button type="button" className="btn small" onClick={() => setRevise((v) => !v)}>
            Revise with director
          </button>
          <span className="grow" />
          <button type="button" className="btn ghost icon" aria-label={`Delete ${item.title}`} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          title="Delete item"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  await act(() => api.removeItem(project.id, item.id))
                  setConfirmDelete(false)
                }}
              >
                Delete item
              </button>
            </>
          }
        >
          <p>
            Remove <strong>{item.title}</strong> from the plan?
          </p>
          {outputs.length > 0 && <p className="muted">Its {outputs.length} generated output{outputs.length === 1 ? '' : 's'} stay in Assets.</p>}
        </Dialog>
      )}
    </article>
  )
}
