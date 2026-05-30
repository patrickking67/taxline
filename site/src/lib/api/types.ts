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
