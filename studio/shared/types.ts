// The contract between the Studio server (studio/server) and the Studio UI (studio/web).
// Everything the UI shows comes from these shapes; the server is the only writer.

export type Stage = 'brief' | 'concepts' | 'plan' | 'production' | 'delivery'
export type QualityMode = 'economy' | 'balanced' | 'premium'
export type MediaKind = 'image' | 'video'
export type AssetGroup = 'key_visual' | 'social' | 'video_shot' | 'supporting' | 'final_video'

export const GROUP_LABEL: Record<AssetGroup, string> = {
  key_visual: 'Key visuals',
  social: 'Social content',
  video_shot: 'Video shots',
  final_video: 'Final videos',
  supporting: 'Supporting assets',
}

export const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '3:4', '4:3', '21:9'] as const

// ---------- Brief ----------

export interface Brief {
  /** The only required field. */
  text: string
  brand?: string
  product?: string
  audience?: string
  objective?: string
  deliverables?: string
  aesthetic?: string
  aspects?: string[]
  /** Asset ids of uploaded visual references / brand assets (assets with origin 'reference'). */
  referenceAssetIds: string[]
}

// ---------- Creative direction ----------

export interface Concept {
  id: string
  name: string
  idea: string
  visualLanguage: string
  artDirection: string
  cinematography: string
  /** 3 to 6 colours. */
  palette: { name: string; hex: string }[]
  message: string
  deliverables: string[]
  productionApproach: string
  /** Which round of proposals this came from (1 = first). */
  round: number
}

// ---------- Production plan ----------

export interface PlanItem {
  id: string
  title: string
  group: AssetGroup
  kind: MediaKind
  purpose: string
  description: string
  prompt: string
  modelId: string
  /** One sentence: why this model. Empty when the user overrode the choice. */
  modelReason: string
  aspect: string
  /** Model-specific label, one of the model's `resolutions`. */
  resolution: string
  /** Video only. */
  durationSec: number
  /** Images per generation (1 for video). */
  variations: number
  /** Item ids whose approved output is fed in as reference. A video needs exactly one image item here. */
  dependsOn: string[]
  /** A specific asset to use as reference instead of "the approved output of dependsOn". */
  pinnedAssetId?: string
  /** Feed the brief's uploaded reference images to the model as well. */
  useBriefReferences: boolean
}

export interface Plan {
  campaignTitle: string
  summary: string
  /** The identity that must not drift: product, character, palette, light. Shown to the user and given to Claude on revisions. */
  continuity: string
  items: PlanItem[]
}

// ---------- Costs ----------

export interface Estimate {
  /** null = the price could not be established; such a job needs explicit approval. */
  usd: number | null
  /** Human-readable basis, e.g. "4 images × $0.04 / image" or "No live price: FAL_KEY missing". */
  basis: string
  /** True when the unit price is known but resolution/length adjustments may apply. */
  approximate: boolean
}

export interface ItemCost {
  itemId: string
  estimate: Estimate
  /** The same item under each quality mode's default model. */
  alternatives: Record<QualityMode, { modelId: string; estimate: Estimate }>
}

export interface CostSummary {
  /** Hard cap approved by the user; null until a budget is approved. */
  budgetUsd: number | null
  /** Reserved (pending/in flight) + spent (done). What the budget check counts. */
  committedUsd: number
  reservedUsd: number
  /** Finished jobs: actual where fal reported it, estimate otherwise. */
  spentUsd: number
  /** Portion of spentUsd that is a confirmed charge from fal billing. */
  actualUsd: number
  imageUsd: number
  videoUsd: number
  otherUsd: number
  /** Claude usage: tokens × list price. Not counted against the media budget. */
  llmUsd: number
  llmCalls: number
  /** Jobs finished or in flight whose price was never established. */
  unknownJobs: number
  /** Estimate for the whole plan as it stands, one generation per item. */
  planUsd: number
  planUnknownItems: number
  planByMode: Record<QualityMode, { usd: number; unknownItems: number }>
  items: ItemCost[]
}

// ---------- Jobs and assets ----------

export type JobStatus =
  | 'pending' // budget reserved; waiting for a dependency, a free slot, or resume
  | 'submitting'
  | 'queued'
  | 'running'
  | 'saving' // downloading the result into local storage
  | 'done'
  | 'failed'
  | 'cancelled'

export const ACTIVE_JOB: JobStatus[] = ['pending', 'submitting', 'queued', 'running', 'saving']

export interface Job {
  id: string
  itemId: string
  kind: MediaKind
  modelId: string
  endpoint: string
  prompt: string
  aspect: string
  resolution: string
  durationSec: number
  count: number
  /** Explicit reference assets (variation source, pinned keyframe, brief references). */
  refAssetIds: string[]
  /** Items whose approved output must exist before this can be submitted. */
  waitForItemIds: string[]
  status: JobStatus
  /** Why a pending job is not moving: "Waiting for approval of Hero visual", "Paused", "Waiting for a free slot". */
  waiting?: string
  falRequestId?: string
  estimate: Estimate
  /** Charge reported by fal billing, when retrievable. */
  actualUsd?: number
  /** True when this ran in dry-run mode: no API call, placeholder output. */
  dryRun: boolean
  error?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export type AssetStatus = 'new' | 'approved' | 'rejected'

export interface Asset {
  id: string
  /** '' for brief references. */
  itemId: string
  jobId: string
  origin: 'generated' | 'reference' | 'assembled'
  kind: MediaKind
  /** URL path the browser can load, e.g. /api/studio/files/<project>/<file>. */
  url: string
  mime: string
  bytes: number
  status: AssetStatus
  /** The preferred output of its item; used first as reference for dependents. */
  preferred: boolean
  /** Placeholder produced in dry-run mode. Never a real generation. */
  dryRun: boolean
  prompt: string
  modelId: string
  /** The asset this was made from (variation or animated keyframe). */
  parentAssetId?: string
  createdAt: string
}

// ---------- Conversation log ----------

export interface LogEntry {
  id: string
  at: string
  role: 'user' | 'director' | 'system'
  text: string
}

export interface LlmCall {
  at: string
  task: string
  model: string
  inputTokens: number
  outputTokens: number
  usd: number
  /** True when the reply came from the built-in sample director, not Claude. */
  sample: boolean
}

// ---------- Project ----------

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  stage: Stage
  brief: Brief
  mode: QualityMode
  /** The user's stated maximum, from the brief. The approved cap lives in costs.budgetUsd. */
  maxBudgetUsd: number | null
  /** Hard cap for media spend, set when the user approves a budget. */
  approvedBudgetUsd: number | null
  /** false = dry run: placeholders, no fal calls, no charges. */
  live: boolean
  paused: boolean
  /** All proposed concepts, every round. */
  concepts: Concept[]
  /** The approved direction (a chosen concept, possibly edited or combined). */
  direction: Concept | null
  plan: Plan | null
  jobs: Job[]
  assets: Asset[]
  log: LogEntry[]
  llm: LlmCall[]
  caseStudy: string | null
  /** What the creative director (Claude) is doing right now; null when idle. */
  agentTask: null | 'concepts' | 'direction' | 'plan' | 'revise' | 'case-study'
  agentError: string | null
}

/** What GET /projects/:id returns: the stored project plus computed costs. */
export interface ProjectView extends Project {
  costs: CostSummary
}

export interface ProjectCard {
  id: string
  name: string
  stage: Stage
  updatedAt: string
  live: boolean
  coverUrl: string | null
  assetCount: number
  approvedCount: number
  activeJobs: number
  spentUsd: number
  budgetUsd: number | null
}

// ---------- Models ----------

export interface ModelInfo {
  id: string
  label: string
  kind: MediaKind
  tier: QualityMode
  /** fal endpoint ids this adapter calls. */
  endpoints: string[]
  aspects: string[]
  resolutions: string[]
  /** Video: allowed durations in seconds [min, max]. */
  duration?: [number, number]
  maxVariations: number
  /** Can take reference images (edit / image-to-video). */
  acceptsReferences: boolean
  requiresReference: boolean
  strengths: string
  /** Live unit price from fal for the primary endpoint; null when unknown. */
  price: { unitPrice: number; unit: string; currency: string } | null
}

export interface StudioStatus {
  /** ANTHROPIC_API_KEY present on the server. false = sample director only. */
  anthropic: boolean
  /** FAL_KEY present on the server. false = dry run only. */
  fal: boolean
  claudeModel: string
  pricing: { fetchedAt: string | null; known: number; total: number; error: string | null }
  /** ffmpeg available: approved video shots can be assembled into one film. */
  assembly: boolean
  maxConcurrency: number
  models: ModelInfo[]
}

// ---------- API (all under /api/studio) ----------
//
// GET    /status                              -> StudioStatus
// GET    /projects                            -> ProjectCard[]
// POST   /projects            NewProject      -> ProjectView
// GET    /projects/:id                        -> ProjectView      (poll this; it also advances the job scheduler)
// PATCH  /projects/:id        ProjectPatch    -> ProjectView
// DELETE /projects/:id                        -> { ok: true }
// POST   /projects/:id/references  (raw image body, content-type image/*)  -> ProjectView
// DELETE /projects/:id/references/:assetId    -> ProjectView
// POST   /projects/:id/concepts    { feedback?: string }             -> ProjectView (agentTask set; poll)
// POST   /projects/:id/direction   DirectionRequest                  -> ProjectView (may set agentTask)
// PUT    /projects/:id/direction   Concept (manual edit)             -> ProjectView
// POST   /projects/:id/plan        { note?: string }                 -> ProjectView (agentTask set; poll)
// POST   /projects/:id/plan/items  Partial<PlanItem>                 -> ProjectView (adds an item)
// PATCH  /projects/:id/plan/items/:itemId  Partial<PlanItem>         -> ProjectView
// DELETE /projects/:id/plan/items/:itemId                            -> ProjectView
// POST   /projects/:id/plan/items/:itemId/revise { note: string }    -> ProjectView (Claude rewrites the prompt; no spend)
// POST   /projects/:id/quote       RunRequest                        -> Quote     (no side effects)
// POST   /projects/:id/run         RunRequest                        -> ProjectView (creates jobs; 409 + ApiError if refused)
// POST   /projects/:id/jobs/:jobId/cancel                            -> ProjectView
// PATCH  /projects/:id/assets/:assetId  AssetPatch                   -> ProjectView
// POST   /projects/:id/animate     { assetId: string }               -> ProjectView (adds a video shot item pinned to that image; no spend)
// POST   /projects/:id/assemble                                      -> ProjectView (ffmpeg: approved shots -> one film; free)
// POST   /projects/:id/case-study                                    -> ProjectView (agentTask set; poll)
// GET    /projects/:id/export.zip                                    -> application/zip
// GET    /files/:projectId/:file                                     -> the media file (supports Range)
//
// Errors: non-2xx with ApiError.

export interface NewProject {
  name?: string
  brief: Omit<Brief, 'referenceAssetIds'>
  mode?: QualityMode
  maxBudgetUsd?: number | null
}

export interface ProjectPatch {
  name?: string
  brief?: Partial<Omit<Brief, 'referenceAssetIds'>>
  mode?: QualityMode
  maxBudgetUsd?: number | null
  /** Raising or lowering the hard cap. Cannot go below what is already committed. */
  approvedBudgetUsd?: number
  paused?: boolean
  /** Switching to live requires confirmLive: true. */
  live?: boolean
  confirmLive?: boolean
  stage?: Stage
  /** Dismiss the director's last error. */
  clearAgentError?: boolean
}

export interface DirectionRequest {
  /** One id = choose it. Several = combine them. */
  conceptIds: string[]
  /** Optional instruction: "make it warmer, lose the neon". With a note or several ids, Claude writes the merged direction. */
  note?: string
}

export interface RunLine {
  itemId: string
  /** Regenerate with a revised prompt (also saved to the item). */
  prompt?: string
  /** Override the item's variation count for this run. */
  count?: number
  /** Make variations of this existing image instead of generating from text. */
  fromAssetId?: string
}

export interface RunRequest {
  lines: RunLine[]
  /** The hard cap the user is approving. Required on the first run; later runs may raise it. */
  budgetUsd?: number
  /** Required true when any line has an unknown price. */
  acceptUnknownCost?: boolean
  /** Client-generated; a repeated key is ignored, so a double click cannot submit twice. */
  idempotencyKey: string
}

export interface Quote {
  lines: { itemId: string; title: string; modelId: string; count: number; estimate: Estimate }[]
  totalUsd: number
  unknownLines: number
  committedUsd: number
  budgetUsd: number | null
  /** committed + total, to compare with the budget. */
  afterUsd: number
  live: boolean
  /** Why the server would refuse this run as it stands; empty when it would accept. */
  problems: string[]
}

export interface AssetPatch {
  status?: AssetStatus
  preferred?: boolean
}

export interface ApiError {
  error: string
  /** 'budget' | 'unknown_cost' | 'not_found' | 'invalid' | 'busy' | 'not_configured' */
  code: string
}
