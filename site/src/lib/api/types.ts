// API surface for Taxline. The site is static (GitHub Pages); these adapters are
// the seam between the static frontend and a real backend (Cloudflare Worker by
// default, swappable for Azure Functions / Supabase / Formspree).

export interface DemoRequest {
  name?: string;
  email: string;
  firm?: string;
  seats?: number;
  engagement?: string;
  message?: string;
  /** honeypot — must be empty */
  company_website?: string;
}

export interface DemoResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface ApiAdapter {
  readonly name: string;
  submitDemo(req: DemoRequest): Promise<DemoResult>;
}

// ---- App domain types (intake queue, extraction review) -------------------
export type DocStatus = 'new' | 'review' | 'approved' | 'archived';

export interface ExtractionField {
  label: string;
  value: string;
  /** 0..1 confidence; null = not yet extracted */
  confidence: number | null;
}

export interface Evidence {
  icon: string; // lucide name
  label: string;
  strong?: string;
}

export interface AppDoc {
  id: string;
  name: string;
  client: string;
  type: string; // W-2, 1099-NEC, K-1, Schedule, Expense
  lastAgent: string; // Intake | Extraction | Research | Workpaper | Compliance
  status: DocStatus;
  confidence: number | null;
  pages: number;
  docTitle?: string;
  fields: ExtractionField[];
  evidence: Evidence[];
}

// ---- Fleet service (live agent backend, or a local mock) ------------------
// Mirrors the service/ endpoints: /health, /queue, /doc/:id, /agents/run,
// /memory/search. The mock implements the same contract entirely client-side so
// the app is fully functional on static hosting; the `service` adapter talks to
// the deployed Node fleet when PUBLIC_API_ADAPTER + PUBLIC_SERVICE_ENDPOINT are set.

export interface FleetCitation {
  /** Source file (relative to the knowledge base) or document name. */
  file: string;
  heading?: string | null;
  snippet?: string | null;
  score?: number;
}

export interface FleetField {
  label: string;
  /** Nullable on purpose: the fleet returns null rather than fabricating. */
  value: string | null;
  confidence: number | null;
  citations?: FleetCitation[];
}

export interface FleetReviewItem {
  reason: string;
  label?: string;
  value?: string | null;
  confidence?: number | null;
}

export interface FleetStep {
  agent: string;
  model?: string;
  toolCalls?: { name: string; ok: boolean }[];
  handoffTo?: string | null;
}

export interface RunInput {
  task: string;
  agent?: string;
  docId?: string;
  /** The human-approval gate: final output is withheld until this is true. */
  approved?: boolean;
}

export interface RunResult {
  output: string;
  citations: FleetCitation[];
  fields?: FleetField[];
  needsHumanReview: FleetReviewItem[];
  trace: FleetStep[];
  approved: boolean;
}

export interface FleetHealth {
  ok: boolean;
  /** false => deterministic offline mode (no ANTHROPIC_API_KEY on the host). */
  liveAgents: boolean;
  provider: string;
  records: number;
  agents: string[];
  models?: { default: string; fast: string };
  note?: string;
}

export interface MemoryHit {
  text: string;
  file: string;
  heading: string | null;
  score: number;
}

export interface FleetService {
  readonly name: string;
  /** Liveness + config snapshot (no secrets). */
  health(): Promise<FleetHealth>;
  /** Intake-queue summary. */
  queue(): Promise<AppDoc[]>;
  /** One document with full fields + evidence, or null if unknown. */
  doc(id: string): Promise<AppDoc | null>;
  /** Run a task through the orchestrator; the result honors the human-approval gate. */
  run(input: RunInput): Promise<RunResult>;
  /** Cosine search over the vector memory (indexed KB + approved findings). */
  memorySearch(query: string, k?: number): Promise<MemoryHit[]>;
}
