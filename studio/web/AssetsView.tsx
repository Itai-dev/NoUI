// Assets: review every output, then the organised delivery view with export, case study and cost report.
import { useMemo, useState } from 'react'
import { GROUP_LABEL } from '../shared/types.ts'
import type { Asset, AssetGroup, AssetStatus, MediaKind } from '../shared/types.ts'
import { api } from './api.ts'
import { AssetBadges, Dialog, fileName, Icon, Markdown, Media, Segmented, Spinner, usd } from './parts.tsx'
import type { Ctx } from './parts.tsx'

const GROUPS: AssetGroup[] = ['key_visual', 'social', 'video_shot', 'final_video', 'supporting']

function groupOf(ctx: Ctx, a: Asset): AssetGroup {
  if (a.origin === 'assembled') return 'final_video'
  return ctx.project.plan?.items.find((i) => i.id === a.itemId)?.group ?? (a.kind === 'video' ? 'video_shot' : 'supporting')
}

function titleOf(ctx: Ctx, a: Asset): string {
  if (a.origin === 'assembled') return 'Assembled film'
  return ctx.project.plan?.items.find((i) => i.id === a.itemId)?.title ?? 'Removed item'
}

export function AssetsView({ ctx }: { ctx: Ctx }) {
  const [mode, setMode] = useState<'review' | 'delivery'>(ctx.project.stage === 'delivery' ? 'delivery' : 'review')
  return (
    <main className="page">
      <div className="page-head">
        <h1 className="display">Assets</h1>
        <Segmented
          label="Assets mode"
          value={mode}
          options={[
            { value: 'review', label: 'Review' },
            { value: 'delivery', label: 'Delivery' },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === 'review' ? <Review ctx={ctx} /> : <Delivery ctx={ctx} />}
    </main>
  )
}

// ---------- Review ----------

function Review({ ctx }: { ctx: Ctx }) {
  const { project, act, openViewer, go } = ctx
  const [group, setGroup] = useState<AssetGroup | 'all'>('all')
  const [status, setStatus] = useState<AssetStatus | 'all'>('all')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)

  const all = useMemo(() => project.assets.filter((a) => a.origin !== 'reference').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [project.assets])
  const list = all.filter((a) => (group === 'all' || groupOf(ctx, a) === group) && (status === 'all' || a.status === status) && (kind === 'all' || a.kind === kind))
  const pair = picked.map((id) => project.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a)

  if (all.length === 0)
    return (
      <div className="empty-page inner">
        <h2 className="display">Nothing produced yet.</h2>
        <p className="muted">Outputs appear here as soon as a job finishes.</p>
        <button type="button" className="btn primary" onClick={() => go(project.plan ? 'production' : 'brief')}>
          {project.plan ? 'Open production board' : 'Go to the brief'}
        </button>
      </div>
    )

  const patch = (a: Asset, p: { status?: AssetStatus; preferred?: boolean }) => act(() => api.patchAsset(project.id, a.id, p))
  const pick = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]))

  return (
    <>
      <div className="filters">
        <Segmented
          label="Group"
          value={group}
          options={[{ value: 'all' as const, label: 'All' }, ...GROUPS.filter((g) => all.some((a) => groupOf(ctx, a) === g)).map((g) => ({ value: g, label: GROUP_LABEL[g] }))]}
          onChange={setGroup}
        />
        <Segmented
          label="Status"
          value={status}
          options={[
            { value: 'all', label: 'Any status' },
            { value: 'new', label: 'To review' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
          onChange={setStatus}
        />
        <Segmented
          label="Kind"
          value={kind}
          options={[
            { value: 'all', label: 'Images and video' },
            { value: 'image', label: 'Images' },
            { value: 'video', label: 'Video' },
          ]}
          onChange={setKind}
        />
        <span className="grow" />
        <button type="button" className="btn" disabled={pair.length !== 2} onClick={() => setComparing(true)}>
          <Icon name="compare" /> {pair.length === 2 ? 'Compare selected' : `Compare (${pair.length}/2)`}
        </button>
      </div>

      {list.length === 0 && <p className="muted group-empty">No assets match these filters.</p>}
      <div className="asset-grid">
        {list.map((a) => {
          const on = picked.includes(a.id)
          return (
            <article key={a.id} className={`asset ${a.status} ${on ? 'picked' : ''}`}>
              <button type="button" className="asset-open" onClick={() => openViewer(a.id)} aria-label={`Open ${titleOf(ctx, a)}`}>
                <Media asset={a} />
              </button>
              <AssetBadges asset={a} />
              <div className="asset-hover">
                <button type="button" className={`btn small ${a.status === 'approved' ? 'on' : ''}`} onClick={() => patch(a, { status: a.status === 'approved' ? 'new' : 'approved' })} aria-label="Approve" title="Approve">
                  <Icon name="check" />
                </button>
                <button type="button" className={`btn small ${a.status === 'rejected' ? 'on bad' : ''}`} onClick={() => patch(a, { status: a.status === 'rejected' ? 'new' : 'rejected' })} aria-label="Reject" title="Reject">
                  <Icon name="x" />
                </button>
                <button type="button" className={`btn small ${a.preferred ? 'on' : ''}`} onClick={() => patch(a, { preferred: !a.preferred })} aria-label="Mark preferred" title="Mark preferred">
                  <Icon name="star" />
                </button>
                <button type="button" className={`btn small ${on ? 'on' : ''}`} onClick={() => pick(a.id)} aria-label="Select for comparison" title="Select for comparison" aria-pressed={on}>
                  <Icon name="compare" />
                </button>
              </div>
              <footer>
                <span className="asset-title">{titleOf(ctx, a)}</span>
                <span className="muted small">{GROUP_LABEL[groupOf(ctx, a)]}</span>
              </footer>
            </article>
          )
        })}
      </div>

      {comparing && pair.length === 2 && (
        <Dialog title="Compare" wide onClose={() => setComparing(false)}>
          <div className="compare">
            {pair.map((a) => (
              <figure key={a.id}>
                <Media asset={a} full controls />
                <figcaption>
                  <span>
                    {titleOf(ctx, a)} <AssetBadges asset={a} />
                  </span>
                  <span className="row">
                    <button type="button" className={`btn small ${a.status === 'approved' ? 'on' : ''}`} onClick={() => patch(a, { status: a.status === 'approved' ? 'new' : 'approved' })}>
                      <Icon name="check" /> Approve
                    </button>
                    <button type="button" className={`btn small ${a.preferred ? 'on' : ''}`} onClick={() => patch(a, { preferred: !a.preferred })}>
                      <Icon name="star" /> Prefer
                    </button>
                    <button type="button" className={`btn small ${a.status === 'rejected' ? 'on bad' : ''}`} onClick={() => patch(a, { status: a.status === 'rejected' ? 'new' : 'rejected' })}>
                      <Icon name="x" /> Reject
                    </button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

// ---------- Delivery ----------

function Delivery({ ctx }: { ctx: Ctx }) {
  const { project, status, act, openViewer } = ctx
  const [copied, setCopied] = useState(false)
  const [assembling, setAssembling] = useState(false)
  const approved = project.assets.filter((a) => a.origin !== 'reference' && a.status === 'approved')
  const shots = approved.filter((a) => a.kind === 'video' && a.origin === 'generated' && !a.dryRun && groupOf(ctx, a) === 'video_shot')
  const c = project.costs
  const drafting = project.agentTask === 'case-study'
  const hasDry = approved.some((a) => a.dryRun)

  const copy = async () => {
    if (!project.caseStudy) return
    try {
      await navigator.clipboard.writeText(project.caseStudy)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  }

  return (
    <div className="delivery">
      <div className="delivery-head">
        <div>
          <span className="eyebrow">Campaign</span>
          <h2 className="display xl">{project.plan?.campaignTitle ?? project.name}</h2>
          <p className="muted">
            {approved.length} approved asset{approved.length === 1 ? '' : 's'}. Only approved work is delivered.
          </p>
        </div>
        <div className="row">
          {status.assembly && shots.length >= 2 && (
            <button
              type="button"
              className="btn"
              disabled={assembling}
              onClick={async () => {
                setAssembling(true)
                await act(() => api.assemble(project.id))
                setAssembling(false)
              }}
            >
              {assembling ? <Spinner label="Assembling" /> : <><Icon name="film" /> Assemble film ({shots.length} shots)</>}
            </button>
          )}
          {approved.length > 0 && (
            <a className="btn primary" href={api.exportUrl(project.id)} download>
              <Icon name="download" /> Download ZIP
            </a>
          )}
        </div>
      </div>

      {hasDry && <p className="note">Some approved assets are dry-run placeholders, not real generations.</p>}
      {approved.length === 0 && <p className="muted group-empty">Approve outputs in Review and they are organised here.</p>}

      {GROUPS.map((g) => {
        const list = approved.filter((a) => groupOf(ctx, a) === g).sort((a, b) => Number(b.preferred) - Number(a.preferred))
        if (list.length === 0) return null
        return (
          <section key={g} className="group">
            <div className="group-head">
              <h2>
                {GROUP_LABEL[g]} <span className="muted num">{list.length}</span>
              </h2>
            </div>
            <div className="asset-grid">
              {list.map((a) => (
                <article key={a.id} className="asset approved">
                  <button type="button" className="asset-open" onClick={() => openViewer(a.id)} aria-label={`Open ${titleOf(ctx, a)}`}>
                    <Media asset={a} />
                  </button>
                  <AssetBadges asset={a} />
                  <footer>
                    <span className="asset-title">{titleOf(ctx, a)}</span>
                    <a className="btn ghost icon" href={a.url} download={fileName(a, titleOf(ctx, a))} aria-label="Download">
                      <Icon name="download" />
                    </a>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )
      })}

      <div className="delivery-cols">
        <section className="block">
          <div className="block-head">
            <span className="eyebrow">Case study draft</span>
            <span className="row">
              {project.caseStudy && (
                <button type="button" className="btn ghost small" onClick={copy}>
                  <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              <button type="button" className="btn small" disabled={drafting || !project.direction} onClick={() => act(() => api.caseStudy(project.id))}>
                {drafting ? <Spinner label="Drafting" /> : project.caseStudy ? 'Redraft' : 'Draft case study'}
              </button>
            </span>
          </div>
          <p className="note">Speculative work — not a commissioned client project. No performance results are claimed.</p>
          {project.caseStudy ? <Markdown text={project.caseStudy} /> : <p className="muted">{project.direction ? 'The director writes a concise draft from the brief, the direction and the deliverables.' : 'Choose a direction first.'}</p>}
        </section>

        <section className="block">
          <div className="block-head">
            <span className="eyebrow">Cost report</span>
          </div>
          <table className="costs">
            <tbody>
              <tr>
                <th>Image generation</th>
                <td className="num">{usd(c.imageUsd)}</td>
              </tr>
              <tr>
                <th>Video generation</th>
                <td className="num">{usd(c.videoUsd)}</td>
              </tr>
              <tr>
                <th>Other model usage</th>
                <td className="num">{usd(c.otherUsd)}</td>
              </tr>
              <tr className="total">
                <th>Media spent</th>
                <td className="num">{usd(c.spentUsd)}</td>
              </tr>
              <tr>
                <th>
                  of which confirmed by fal.ai billing <span className="muted">(actual)</span>
                </th>
                <td className="num">{usd(c.actualUsd)}</td>
              </tr>
              <tr>
                <th>
                  of which estimated <span className="muted">(unit price × quantity)</span>
                </th>
                <td className="num">{usd(Math.max(0, c.spentUsd - c.actualUsd))}</td>
              </tr>
              <tr>
                <th>Reserved for jobs in flight</th>
                <td className="num">{usd(c.reservedUsd)}</td>
              </tr>
              <tr>
                <th>Approved budget cap</th>
                <td className="num">{c.budgetUsd !== null ? usd(c.budgetUsd) : 'none'}</td>
              </tr>
              <tr>
                <th>Jobs with unknown price</th>
                <td className="num">{c.unknownJobs}</td>
              </tr>
              <tr className="total">
                <th>
                  Claude <span className="muted">({c.llmCalls} call{c.llmCalls === 1 ? '' : 's'}; estimate from tokens × list price)</span>
                </th>
                <td className="num">{usd(c.llmUsd)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">Claude usage is reported separately and is not counted against the media budget. Dry-run jobs cost nothing.</p>
        </section>
      </div>
    </div>
  )
}
