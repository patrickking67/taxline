// Shared contracts for the Taxline service.
//
// These types encode the architecture principles the fleet is built on:
//  - Structured errors (never a bare 'failed') so the orchestrator can route on cause.
//  - Provenance on every claim (claim -> source) plus a confidence score.
//  - Tools as plain { name, description, inputSchema, run } records — the description
//    is the PRIMARY mechanism the model uses to pick a tool, so it must be distinct.

import type Anthropic from '@anthropic-ai/sdk';

/**
 * Error taxonomy. Failures are categorized so the orchestrator can decide whether
 * to retry, surface to a human, or stop. A `transient` error is worth retrying; a
 * `validation`/`business`/`permission` error is not (the inputs/rules/access must
 * change first). `isRetryable` is derived but stated explicitly for call sites.
 */
export type ErrorCategory = 'transient' | 'validation' | 'business' | 'permission';

export interface StructuredError {
  ok: false;
  errorCategory: ErrorCategory;
  isRetryable: boolean;
  message: string;
  /** Optional machine detail for logs/telemetry — never user-facing copy. */
  detail?: unknown;
}

/** A successful tool result wraps an arbitrary structured payload. */
export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export type ToolResult<T> = ToolSuccess<T> | StructuredError;

/** Helper constructors keep error shapes consistent across every tool. */
export function ok<T>(data: T): ToolSuccess<T> {
  return { ok: true, data };
}

export function fail(
  errorCategory: ErrorCategory,
  message: string,
  detail?: unknown,
): StructuredError {
  // Only transient failures are retryable; the rest require a changed input,
  // rule, or grant before a retry could ever succeed.
  return { ok: false, errorCategory, isRetryable: errorCategory === 'transient', message, detail };
}

/**
 * A tool the agent loop can dispatch. `inputSchema` is a JSON Schema (Anthropic
 * tool format). `description` is load-bearing: it is how the model selects this
 * tool over its siblings, so each one is written to be unambiguous.
 */
export interface Tool<I = Record<string, unknown>, O = unknown> {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  run(input: I): Promise<ToolResult<O>> | ToolResult<O>;
}

/**
 * A heterogeneous tool reference for collections and dispatch. Individual tools
 * are authored with precise `Tool<I, O>` types; once placed in an agent's tool
 * list or dispatched by name, their specific input type is erased to `any` so the
 * (contravariant) `run` signatures remain mutually assignable. The runtime input
 * comes from the model as JSON and is validated inside each tool's `run`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, unknown>;

/** A provenance-bearing citation: which file/heading a claim came from. */
export interface Citation {
  /** Source file (relative to the knowledge base) or document id. */
  file: string;
  /** Heading/section within the source, when known. */
  heading?: string | null;
  /** Relevance score from retrieval, when applicable. */
  score?: number;
  /** Short snippet supporting the claim. */
  snippet?: string;
}

/** A single extracted field with provenance and a confidence score. */
export interface ExtractedField {
  label: string;
  /** Nullable on purpose: the model returns null rather than fabricating a value. */
  value: string | null;
  /** 0..1; null when not extracted at all. */
  confidence: number | null;
  /** Where the value was read from. */
  citations: Citation[];
}

/** Item flagged for a human: a low-confidence field or an undecidable call. */
export interface ReviewItem {
  reason: string;
  label?: string;
  value?: string | null;
  confidence?: number | null;
}

/**
 * The orchestrator's final, structured result. `output` is the human-readable
 * answer; everything else is the machine-checkable scaffolding around it.
 */
export interface OrchestratorResult {
  output: string;
  citations: Citation[];
  fields?: ExtractedField[];
  needsHumanReview: ReviewItem[];
  /** Trace of which agents ran, in order, for transparency/debugging. */
  trace: AgentStep[];
  /** True once a human has approved shipping this output. */
  approved: boolean;
}

export interface AgentStep {
  agent: string;
  model: string;
  toolCalls: { name: string; ok: boolean }[];
  handoffTo?: string | null;
}

/** Confidence below this routes a field to human review. */
export const CONFIDENCE_THRESHOLD = 0.85;
