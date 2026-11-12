// Typed client for the Studio server. Every call returns the server's view; the UI never invents state.
import type {
  ApiError,
  AssetPatch,
  Concept,
  DirectionRequest,
  NewProject,
  PlanItem,
  ProjectCard,
  ProjectPatch,
  ProjectView,
  Quote,
  RunRequest,
  StudioStatus,
} from '../shared/types.ts'

const BASE = '/api/studio'

export class ApiFailure extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { body: Blob; type: string }): Promise<T> {
  const init: RequestInit = { method, headers: {} }
  if (raw) {
    init.body = raw.body
    init.headers = { 'content-type': raw.type }
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch {
    throw new ApiFailure('The Studio server is not reachable.', 'network', 0)
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = data as Partial<ApiError> | null
    const message = e && typeof e.error === 'string' ? e.error : res.status === 404 ? 'The Studio server is not available on this host.' : `Request failed (${res.status})`
    throw new ApiFailure(message, (e && e.code) || 'http', res.status)
  }
  return data as T
}

const p = (id: string) => `/projects/${encodeURIComponent(id)}`

export const api = {
  status: () => request<StudioStatus>('GET', '/status'),
  projects: () => request<ProjectCard[]>('GET', '/projects'),
  create: (body: NewProject) => request<ProjectView>('POST', '/projects', body),
  get: (id: string) => request<ProjectView>('GET', p(id)),
  patch: (id: string, patch: ProjectPatch) => request<ProjectView>('PATCH', p(id), patch),
  remove: (id: string) => request<{ ok: true }>('DELETE', p(id)),
  addReference: (id: string, file: Blob) => request<ProjectView>('POST', `${p(id)}/references`, undefined, { body: file, type: file.type || 'image/png' }),
  removeReference: (id: string, assetId: string) => request<ProjectView>('DELETE', `${p(id)}/references/${encodeURIComponent(assetId)}`),
  concepts: (id: string, feedback?: string) => request<ProjectView>('POST', `${p(id)}/concepts`, feedback ? { feedback } : {}),
  direction: (id: string, body: DirectionRequest) => request<ProjectView>('POST', `${p(id)}/direction`, body),
  putDirection: (id: string, concept: Concept) => request<ProjectView>('PUT', `${p(id)}/direction`, concept),
  plan: (id: string, note?: string) => request<ProjectView>('POST', `${p(id)}/plan`, note ? { note } : {}),
  addItem: (id: string, item: Partial<PlanItem>) => request<ProjectView>('POST', `${p(id)}/plan/items`, item),
  patchItem: (id: string, itemId: string, patch: Partial<PlanItem>) => request<ProjectView>('PATCH', `${p(id)}/plan/items/${encodeURIComponent(itemId)}`, patch),
  removeItem: (id: string, itemId: string) => request<ProjectView>('DELETE', `${p(id)}/plan/items/${encodeURIComponent(itemId)}`),
  revise: (id: string, itemId: string, note: string) => request<ProjectView>('POST', `${p(id)}/plan/items/${encodeURIComponent(itemId)}/revise`, { note }),
  quote: (id: string, body: RunRequest) => request<Quote>('POST', `${p(id)}/quote`, body),
  run: (id: string, body: RunRequest) => request<ProjectView>('POST', `${p(id)}/run`, body),
  cancelJob: (id: string, jobId: string) => request<ProjectView>('POST', `${p(id)}/jobs/${encodeURIComponent(jobId)}/cancel`),
  patchAsset: (id: string, assetId: string, patch: AssetPatch) => request<ProjectView>('PATCH', `${p(id)}/assets/${encodeURIComponent(assetId)}`, patch),
  animate: (id: string, assetId: string) => request<ProjectView>('POST', `${p(id)}/animate`, { assetId }),
  assemble: (id: string) => request<ProjectView>('POST', `${p(id)}/assemble`),
  caseStudy: (id: string) => request<ProjectView>('POST', `${p(id)}/case-study`),
  exportUrl: (id: string) => `${BASE}${p(id)}/export.zip`,
}
