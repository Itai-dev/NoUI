// The campaign gallery.
import { useEffect, useState } from 'react'
import type { ProjectCard } from '../shared/types.ts'
import { api } from './api.ts'
import { ago, Dialog, errorText, Icon, Spinner, STAGE_LABEL, usd } from './parts.tsx'

export function Projects({ onError }: { onError: (message: string) => void }) {
  const [cards, setCards] = useState<ProjectCard[] | null>(null)
  const [deleting, setDeleting] = useState<ProjectCard | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    const load = () =>
      api
        .projects()
        .then((c) => !stop && setCards(c))
        .catch((e) => {
          if (stop) return
          setCards((c) => c ?? [])
          onError(errorText(e))
        })
    load()
    const t = setInterval(() => !document.hidden && load(), 5000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [onError])

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await api.remove(deleting.id)
      setCards((c) => (c ?? []).filter((x) => x.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      onError(errorText(e))
    }
    setBusy(false)
  }

  if (!cards)
    return (
      <main className="empty-page">
        <Spinner label="Loading campaigns" />
      </main>
    )

  if (cards.length === 0)
    return (
      <main className="empty-page">
        <h1 className="display xl">One brief. A whole campaign.</h1>
        <p className="muted lead">Describe the campaign. The director proposes three directions, plans the production, shows what it will cost, and produces it once you approve.</p>
        <a className="btn primary large" href="#/new">
          <Icon name="plus" /> New campaign
        </a>
      </main>
    )

  const sorted = [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="display">Campaigns</h1>
        <a className="btn primary" href="#/new">
          <Icon name="plus" /> New campaign
        </a>
      </div>
      <div className="project-grid">
        {sorted.map((c) => (
          <article key={c.id} className="project-card">
            <a className="project-cover" href={`#/p/${encodeURIComponent(c.id)}/${c.stage === 'production' ? 'production' : c.stage === 'delivery' ? 'assets' : 'brief'}`} aria-label={`Open ${c.name}`}>
              {c.coverUrl ? <img src={c.coverUrl} alt="" loading="lazy" /> : <span className="cover-empty display">{c.name.slice(0, 1).toUpperCase()}</span>}
              <span className="cover-badges">
                <span className={`mode-badge small ${c.live ? 'live' : ''}`}>{c.live ? 'LIVE' : 'DRY RUN'}</span>
                {c.activeJobs > 0 && (
                  <span className="pulse-chip">
                    <span className="pulse" /> {c.activeJobs} running
                  </span>
                )}
              </span>
            </a>
            <div className="project-meta">
              <div className="project-title">
                <a href={`#/p/${encodeURIComponent(c.id)}/brief`}>{c.name}</a>
                <button type="button" className="btn ghost icon" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
                  <Icon name="trash" />
                </button>
              </div>
              <div className="project-facts">
                <span className="stage-tag">{STAGE_LABEL[c.stage]}</span>
                <span>
                  {c.assetCount} asset{c.assetCount === 1 ? '' : 's'} · {c.approvedCount} approved
                </span>
                <span className="num">
                  {usd(c.spentUsd)}
                  {c.budgetUsd !== null && <span className="muted"> / {usd(c.budgetUsd)}</span>}
                </span>
                <span className="muted">{ago(c.updatedAt)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {deleting && (
        <Dialog
          title="Delete campaign"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={() => setDeleting(null)}>
                Keep
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{deleting.name}</strong> with its plan and {deleting.assetCount} stored asset{deleting.assetCount === 1 ? '' : 's'}? This cannot be undone.
          </p>
        </Dialog>
      )}
    </main>
  )
}
