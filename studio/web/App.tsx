// Shell: routing, polling, the top bar, and the dialogs shared by every view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectView, RunLine, Stage, StudioStatus } from '../shared/types.ts'
import { api, ApiFailure } from './api.ts'
import { AssetViewer, Draft, errorText, isActive, RunDialog, Spinner, STAGE_LABEL, usd } from './parts.tsx'
import type { Ctx, ViewName } from './parts.tsx'
import { Projects } from './Projects.tsx'
import { BriefComposer, BriefView } from './BriefView.tsx'
import { ProductionView } from './ProductionView.tsx'
import { AssetsView } from './AssetsView.tsx'

type Route = { name: 'projects' } | { name: 'new' } | { name: 'project'; id: string; view: ViewName }

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'new') return { name: 'new' }
  if (parts[0] === 'p' && parts[1]) {
    const view = parts[2] === 'production' || parts[2] === 'assets' ? parts[2] : 'brief'
    return { name: 'project', id: decodeURIComponent(parts[1]), view }
  }
  return { name: 'projects' }
}

const STAGES: Stage[] = ['brief', 'concepts', 'plan', 'production', 'delivery']
const TASK_LABEL = { concepts: 'proposing directions', direction: 'writing the direction', plan: 'building the production plan', revise: 'revising a prompt', 'case-study': 'drafting the case study' } as const

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))
  const [status, setStatus] = useState<StudioStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [project, setProject] = useState<ProjectView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')
  const [runPreset, setRunPreset] = useState<RunLine[] | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState('')
  const [lastTask, setLastTask] = useState<ProjectView['agentTask']>(null)

  const version = useRef(0)
  const projectRef = useRef<ProjectView | null>(null)
  const kick = useRef<(delay?: number) => void>(() => {})
  projectRef.current = project

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Server capabilities: keys present, live prices, model catalogue.
  useEffect(() => {
    let stop = false
    const load = () =>
      api
        .status()
        .then((s) => {
          if (stop) return
          setStatus(s)
          setStatusError('')
        })
        .catch((e) => !stop && setStatusError(errorText(e)))
    load()
    const t = setInterval(() => !document.hidden && load(), 60000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  const apply = useCallback((p: ProjectView) => {
    version.current++
    setProject(p)
    if (p.agentTask) setLastTask(p.agentTask)
    kick.current(1500)
  }, [])

  const projectId = route.name === 'project' ? route.id : null

  // Poll the open project: fast while the director or a job is working, slow otherwise, never while hidden.
  useEffect(() => {
    setProject(null)
    setLoadError('')
    setViewerId(null)
    setRunPreset(null)
    if (!projectId) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delay?: number) => {
      clearTimeout(timer)
      const p = projectRef.current
      const fast = !!p && (p.agentTask !== null || p.jobs.some(isActive))
      timer = setTimeout(tick, delay ?? (fast ? 1500 : 6000))
    }
    const tick = async () => {
      if (stop) return
      if (!document.hidden) {
        const v = version.current
        try {
          const p = await api.get(projectId)
          if (stop) return
          if (v === version.current) {
            projectRef.current = p
            setProject(p)
            if (p.agentTask) setLastTask(p.agentTask)
          }
          setLoadError('')
        } catch (e) {
          if (stop) return
          if (e instanceof ApiFailure && e.status === 404) setLoadError('This campaign no longer exists.')
          else if (!projectRef.current) setLoadError(errorText(e))
        }
      }
      if (!stop) schedule()
    }
    kick.current = (delay) => !stop && schedule(delay)
    const onVisible = () => !document.hidden && schedule(0)
    document.addEventListener('visibilitychange', onVisible)
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
      kick.current = () => {}
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [projectId])

  const act = useCallback(
    async (fn: () => Promise<ProjectView>) => {
      try {
        apply(await fn())
        setToast('')
        return true
      } catch (e) {
        setToast(errorText(e))
        return false
      }
    },
    [apply],
  )

  const go = useCallback(
    (view: ViewName) => {
      if (projectId) location.hash = `#/p/${encodeURIComponent(projectId)}/${view}`
    },
    [projectId],
  )

  const ctx: Ctx | null = useMemo(
    () => (project && status ? { project, status, act, go, openRun: (lines) => setRunPreset(lines ?? []), openViewer: setViewerId } : null),
    [project, status, act, go],
  )

  if (statusError && !status) {
    return (
      <div className="app">
        <TopBar />
        <main className="empty-page">
          <h1 className="display">The Studio server is not running here.</h1>
          <p className="muted">
            Studio needs its local server for planning, budgets and storage. Start it with <code>npm run dev</code> and open <code>http://localhost:5173/studio/</code>.
          </p>
          <p className="muted small">{statusError}</p>
          <a className="btn" href="/">
            Open Atelier
          </a>
        </main>
      </div>
    )
  }

  const agentError = project?.agentError && project.agentError !== dismissedError ? project.agentError : ''
  const retry =
    project && lastTask === 'concepts'
      ? () => api.concepts(project.id)
      : project && lastTask === 'plan'
        ? () => api.plan(project.id)
        : project && lastTask === 'case-study'
          ? () => api.caseStudy(project.id)
          : null

  return (
    <div className="app">
      <TopBar status={status} project={project} view={route.name === 'project' ? route.view : undefined} onRename={(name) => project && act(() => api.patch(project.id, { name }))} />

      {toast && (
        <div className="banner bad" role="alert">
          <span>{toast}</span>
          <button type="button" className="btn ghost small" onClick={() => setToast('')}>
            Dismiss
          </button>
        </div>
      )}
      {agentError && project && (
        <div className="banner bad" role="alert">
          <span>The director stopped: {agentError}</span>
          {retry && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setDismissedError(agentError)
                act(retry)
              }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setDismissedError(agentError)
              act(() => api.patch(project.id, { clearAgentError: true }))
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {project?.agentTask && route.name === 'project' && route.view !== 'brief' && (
        <div className="banner">
          <Spinner label={`The director is ${TASK_LABEL[project.agentTask]}…`} />
        </div>
      )}

      {!status ? (
        <main className="empty-page">
          <Spinner label="Connecting to the Studio server" />
        </main>
      ) : route.name === 'projects' ? (
        <Projects onError={setToast} />
      ) : route.name === 'new' ? (
        <main className="page narrow">
          <BriefComposer
            status={status}
            onCreated={(p) => {
              apply(p)
              location.hash = `#/p/${encodeURIComponent(p.id)}/brief`
            }}
          />
        </main>
      ) : loadError ? (
        <main className="empty-page">
          <h1 className="display">{loadError}</h1>
          <a className="btn" href="#/">
            All campaigns
          </a>
        </main>
      ) : !ctx ? (
        <main className="empty-page">
          <Spinner label="Opening campaign" />
        </main>
      ) : route.view === 'brief' ? (
        <BriefView ctx={ctx} />
      ) : route.view === 'production' ? (
        <ProductionView ctx={ctx} />
      ) : (
        <AssetsView ctx={ctx} />
      )}

      {ctx && runPreset && (
        <RunDialog
          project={ctx.project}
          status={ctx.status}
          preset={runPreset}
          onClose={() => setRunPreset(null)}
          onDone={(p) => {
            setRunPreset(null)
            setViewerId(null)
            apply(p)
            go('production')
          }}
        />
      )}
      {ctx && viewerId && !runPreset && <AssetViewer ctx={ctx} assetId={viewerId} onNavigate={setViewerId} onClose={() => setViewerId(null)} />}
    </div>
  )
}

function TopBar({ status, project, view, onRename }: { status?: StudioStatus | null; project?: ProjectView | null; view?: ViewName; onRename?: (name: string) => void }) {
  const stageIndex = project ? STAGES.indexOf(project.stage) : -1
  const c = project?.costs
  const cap = c?.budgetUsd ?? null
  const pct = (n: number) => (cap && cap > 0 ? Math.min(100, (n / cap) * 100) : 0)
  return (
    <header className="topbar">
      <div className="topbar-row">
        <a className="wordmark" href="#/">
          Studio
        </a>
        {project && (
          <>
            <span className="slash" aria-hidden="true">
              /
            </span>
            <Draft className="project-name" value={project.name} label="Campaign name" onCommit={(v) => v.trim() && onRename?.(v.trim())} />
            <nav className="tabs" aria-label="Views">
              {(['brief', 'production', 'assets'] as ViewName[]).map((v) => (
                <a key={v} href={`#/p/${encodeURIComponent(project.id)}/${v}`} className={v === view ? 'on' : ''} aria-current={v === view ? 'page' : undefined}>
                  {v === 'brief' ? 'Brief' : v === 'production' ? 'Production' : 'Assets'}
                </a>
              ))}
            </nav>
          </>
        )}
        <span className="grow" />
        {status && !status.anthropic && <span className="chip warn">Sample director — add ANTHROPIC_API_KEY</span>}
        {status && !status.fal && <span className="chip warn">No FAL_KEY — dry run only</span>}
        {project && c && (
          <div className="budget" title={`Spent ${usd(c.spentUsd)} · reserved ${usd(c.reservedUsd)}${cap !== null ? ` · cap ${usd(cap)}` : ''}`}>
            <span className="budget-text num">
              {usd(c.committedUsd)} <span className="muted">/ {cap !== null ? usd(cap) : 'no budget approved'}</span>
            </span>
            <span className="meter" aria-hidden="true">
              <span className="meter-spent" style={{ width: `${pct(c.spentUsd)}%` }} />
              <span className="meter-new" style={{ width: `${pct(c.reservedUsd)}%` }} />
            </span>
            <span className="budget-legend">
              spent {usd(c.spentUsd)} · reserved {usd(c.reservedUsd)}
            </span>
          </div>
        )}
        {project && <span className={`mode-badge ${project.live ? 'live' : ''}`}>{project.live ? 'LIVE' : 'DRY RUN'}</span>}
        <a className="top-link" href="/">
          Atelier
        </a>
      </div>
      {project && (
        <ol className="rail" aria-label="Workflow stage">
          {STAGES.map((s, i) => (
            <li key={s} className={i < stageIndex ? 'done' : i === stageIndex ? 'now' : ''} aria-current={i === stageIndex ? 'step' : undefined}>
              <span className="rail-dot" />
              {STAGE_LABEL[s]}
            </li>
          ))}
        </ol>
      )}
    </header>
  )
}
