// The orchestrator — the hub in the hub-and-spoke.
//
// It owns: decomposition (which agent starts), routing (following handoffs),
// error handling (acting on structured errors), aggregation (merging citations,
// fields, and review items), and — critically — the PROGRAMMATIC human-approval
// gate that blocks any final "ship" output until a human approves. Agents are
// spokes: isolated context, explicit task input, no agent-to-agent calls.

import { runAgent, MAX_ITERATIONS, type AgentDefinition, type MessagesClient, type RunAgentOutput } from './agent.js';
import { intake } from './agents/intake.js';
import { extraction } from './agents/extraction.js';
import { research } from './agents/research.js';
import { workpaper } from './agents/workpaper.js';
import { compliance } from './agents/compliance.js';
import { memory } from './memory/index.js';
import { reviewReason, validConfidence } from './tools/confidence.js';
import {
  type OrchestratorResult,
  type Citation,
  type ExtractedField,
  type ReviewItem,
  type AgentStep,
  type StructuredError,
} from './types.js';

/**
 * The agent registry the orchestrator routes over. `satisfies` keeps the literal
 * key union (so AgentName is 'intake' | 'extraction' | ...) while still checking
 * every value is a valid AgentDefinition.
 */
const REGISTRY = {
  intake,
  extraction,
  research,
  workpaper,
  compliance,
} satisfies Record<string, AgentDefinition>;

export type AgentName = keyof typeof REGISTRY;

export interface OrchestratorTask {
  /** Free-text description of the work. */
  task: string;
  /**
   * Optional explicit entry agent. If omitted, the orchestrator picks one from
   * the task text (simple keyword routing — the decomposition step).
   */
  agent?: AgentName;
  /** Optional document id the work concerns (threaded to agents as context). */
  docId?: string;
  /**
   * Whether a human has approved shipping. The gate below is enforced in CODE:
   * final output is withheld until this is true. Defaults to false.
   */
  approved?: boolean;
  /**
   * Cap on agents run, as a routing backstop (not the primary stop). Clamped by
   * clampMaxHops. If the cap stops the chain before it ends, a review item says so.
   */
  maxHops?: number;
}

/** Hop cap used when the caller gives none or gives a value that is not a finite number. */
export const DEFAULT_MAX_HOPS = 5;
/** Upper bound on the hop cap: one run per registered agent. */
export const MAX_HOPS_LIMIT = Object.keys(REGISTRY).length;

/**
 * Clamp a client-supplied hop cap to 1..MAX_HOPS_LIMIT. At least the entry agent
 * always runs, and no client can ask for an unbounded chain.
 */
export function clampMaxHops(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_HOPS;
  return Math.min(MAX_HOPS_LIMIT, Math.max(1, Math.floor(value)));
}

/**
 * Decomposition: choose the starting agent when one isn't specified. This is the
 * orchestrator's job, not an agent's. Keyword routing keeps it explainable.
 */
export function pickEntryAgent(task: string): AgentName {
  const t = task.toLowerCase();
  if (/(deadline|due date|file by|extension|follow[- ]?up|calendar)/.test(t)) return 'compliance';
  if (/(research|what is|how do|rule|cite|guidance|treatment|deduct)/.test(t)) return 'research';
  if (/(workpaper|assemble|reviewer|wp-)/.test(t)) return 'workpaper';
  if (/(extract|pull fields|read the|values from)/.test(t)) return 'extraction';
  if (/(classify|route|intake|incoming|new document|triage)/.test(t)) return 'intake';
  return 'intake'; // default front door
}

/**
 * THE PROGRAMMATIC GATE.
 *
 * This is a function, not a prompt instruction. The orchestrator calls it before
 * returning any result whose output would "ship". If approval is absent, it
 * rewrites the result into a blocked state: the draft is preserved for the human,
 * but `approved` stays false and the output is clearly marked as withheld. No code
 * path returns shippable output without this returning true first.
 */
export function requireHumanApproval(
  result: OrchestratorResult,
  approved: boolean,
): OrchestratorResult {
  if (approved) {
    return { ...result, approved: true };
  }
  return {
    ...result,
    approved: false,
    output:
      'HUMAN APPROVAL REQUIRED — output withheld.\n\n' +
      'Nothing ships from the Taxline fleet until a human approves. The draft below is ' +
      'ready for review.\n\n' +
      '----- DRAFT (not yet shipped) -----\n' +
      result.output,
    // Surface the gate itself as a review item so it is visible in the queue.
    needsHumanReview: [
      { reason: 'human approval required before shipping' },
      ...result.needsHumanReview,
    ],
  };
}

function dedupeCitations(cits: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of cits) {
    const key = `${c.file}::${c.heading ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

const fieldKey = (f: { label: string; value: string | null }) => `${f.label}::${f.value ?? ''}`;

/**
 * Pull fields, review items, and errors out of one agent run's tool outputs.
 *
 * extract_fields is the source of truth for field values, scores, and citations.
 * Every extracted field is returned, and any field that does not clear the
 * threshold is also flagged for review, so the gate holds even if the model never
 * calls assess_confidence. assess_confidence can only add review items: a field it
 * reports as passed is accepted only when it matches an extracted field (label and
 * value), and the extracted record is kept, so the model cannot raise a score,
 * change a value, or attach a citation that no tool produced. Tool failures are
 * returned as errors and also as review items, so none is swallowed.
 */
export function aggregateToolOutputs(
  toolOutputs: { name: string; result: { ok: boolean; data?: unknown } }[],
): { fields: ExtractedField[]; review: ReviewItem[]; errors: StructuredError[] } {
  const extracted = new Map<string, ExtractedField>();
  const review: ReviewItem[] = [];
  const errors: StructuredError[] = [];
  const claimedPassed: ExtractedField[] = [];

  for (const { name, result } of toolOutputs) {
    if (!result.ok) {
      const err = result as unknown as StructuredError;
      errors.push(err);
      // Every tool failure is visible to the reviewer, including the ones that do
      // not stop the chain (a missing document, an unsupported form).
      review.push({ reason: `tool "${name}" failed (${err.errorCategory}): ${err.message}` });
      continue;
    }
    const data = result.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') continue;

    // extract_fields: { fields[] }
    const fields = (data as { fields?: ExtractedField[] }).fields;
    if (Array.isArray(fields)) {
      for (const f of fields) {
        extracted.set(fieldKey(f), f);
        const reason = reviewReason(f);
        if (reason) review.push({ reason, label: f.label, value: f.value, confidence: validConfidence(f.confidence) });
      }
    }

    // assess_confidence: { passed[], needsReview[] }
    const needsReview = (data as { needsReview?: ReviewItem[] }).needsReview;
    if (Array.isArray(needsReview)) review.push(...needsReview);
    const passed = (data as { passed?: ExtractedField[] }).passed;
    if (Array.isArray(passed)) claimedPassed.push(...passed);
  }

  for (const f of claimedPassed) {
    if (!extracted.has(fieldKey(f))) {
      review.push({
        reason: 'not traceable to extract_fields output',
        label: f.label,
        value: f.value ?? null,
        confidence: validConfidence(f.confidence),
      });
    }
  }

  return { fields: [...extracted.values()], review, errors };
}

/**
 * Review items for how an agent run ended. A model failure, a truncated answer,
 * a refusal, or the iteration backstop all mean the draft may be incomplete, so a
 * person has to look before it can ship.
 */
export function runIssues(agentName: string, run: Pick<RunAgentOutput, 'error' | 'hitBackstop' | 'stopReason'>): ReviewItem[] {
  const out: ReviewItem[] = [];
  if (run.error) {
    const retry = run.error.isRetryable ? 'retryable' : 'not retryable';
    out.push({ reason: `agent "${agentName}" failed: ${run.error.message} (${run.error.errorCategory}, ${retry})` });
  }
  if (run.hitBackstop) {
    out.push({ reason: `agent "${agentName}" hit the ${MAX_ITERATIONS}-turn backstop before finishing` });
  }
  if (run.stopReason === 'max_tokens') {
    out.push({ reason: `agent "${agentName}" output was cut off at the token limit` });
  }
  if (run.stopReason === 'refusal') {
    out.push({ reason: `agent "${agentName}" declined the task` });
  }
  return out;
}

function dedupeFields(fields: ExtractedField[]): ExtractedField[] {
  return [...new Map(fields.map((f) => [fieldKey(f), f])).values()];
}

function dedupeReview(items: ReviewItem[]): ReviewItem[] {
  const seen = new Set<string>();
  const out: ReviewItem[] = [];
  for (const it of items) {
    const key = `${it.label ?? ''}::${it.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

/**
 * CONTINUOUS LEARNING — remember approved, cited findings.
 *
 * Called ONLY after the human-approval gate has passed (result.approved === true).
 * It writes the key cited finding(s) into the persistent vector memory so future
 * retrievals can draw on prior approved work. We deliberately remember nothing when
 * approval is absent, nothing flagged for review, and nothing without a citation — so
 * unapproved drafts and low-confidence content never enter memory. Failures here are
 * swallowed (logged): a memory hiccup must not break the already-approved result.
 */
async function rememberApprovedFindings(result: OrchestratorResult): Promise<void> {
  if (!result.approved) return; // gate not passed -> never remember.
  if (result.needsHumanReview.length > 0) return; // unresolved review -> not safe to learn.
  if (result.citations.length === 0) return; // no provenance -> nothing groundable to keep.

  // The approved output is the finding; attach the top citation as its provenance so
  // the remembered record is traceable back to a source.
  const top = result.citations[0]!;
  try {
    await memory.remember(result.output, {
      file: top.file,
      heading: top.heading ?? undefined,
      kind: 'finding',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('memory.remember failed (continuous learning skipped):', err instanceof Error ? err.message : err);
  }
}

/**
 * Run a task through the fleet: start at the entry agent, follow handoffs,
 * aggregate everything, then apply the approval gate. Returns one structured
 * result. The handoff hop-count is a backstop only — the chain naturally ends at
 * an agent whose `handoff` is null. If the backstop (or an error) ends the chain
 * early, the result carries a review item saying which agent did not run.
 */
export async function orchestrate(
  task: OrchestratorTask,
  options: { client?: MessagesClient } = {},
): Promise<OrchestratorResult> {
  const entry = task.agent ?? pickEntryAgent(task.task);
  const maxHops = clampMaxHops(task.maxHops);

  const allCitations: Citation[] = [];
  const allFields: ExtractedField[] = [];
  const allReview: ReviewItem[] = [];
  const trace: AgentStep[] = [];
  const outputs: string[] = [];

  let current: AgentName | null = entry;
  let hops = 0;
  // Context threaded between hops; agents still have isolated reasoning, but the
  // orchestrator hands forward the structured artifacts it has aggregated.
  let context: Record<string, unknown> = {};
  if (task.docId) context.docId = task.docId;

  while (current && hops < maxHops) {
    const agent: AgentDefinition | undefined = REGISTRY[current];
    if (!agent) {
      allReview.push({ reason: `chain stopped: no agent named "${current}"` });
      break;
    }

    const run = await runAgent(agent, { task: task.task, context }, options);
    trace.push(run.step);
    allCitations.push(...run.citations);
    if (run.text) outputs.push(`## ${agent.name}\n${run.text}`);

    const agg = aggregateToolOutputs(run.toolOutputs);
    allFields.push(...agg.fields);
    allReview.push(...agg.review);

    // A failed model call means this agent did not finish. Stop the chain: the
    // next agent would build on an incomplete draft.
    allReview.push(...runIssues(agent.name, run));
    if (run.error) break;

    // Error handling lives in the hub. A non-retryable hard error from a tool
    // stops the chain and is surfaced for a human rather than blindly continuing.
    const hardError = agg.errors.find((e) => !e.isRetryable && e.errorCategory !== 'business');
    if (hardError) {
      allReview.push({ reason: `agent "${agent.name}" blocked: ${hardError.message}` });
      break;
    }

    // Carry aggregated artifacts forward so the next agent can build on them.
    context = { ...context, priorFields: allFields, priorAgent: agent.name };

    // Routing: follow the static handoff. The orchestrator owns this decision.
    current = (agent.handoff as AgentName | null) ?? null;
    hops += 1;
  }

  // Human-in-the-loop guarantee: every early stop is visible to the reviewer. The
  // break paths above add their own item; this covers the hop cap. A result with
  // an open review item is never written to memory, even when approved.
  if (current && hops >= maxHops) {
    allReview.push({ reason: `chain stopped at the ${maxHops}-hop limit before agent "${current}" ran` });
  }

  const draft: OrchestratorResult = {
    output: outputs.join('\n\n') || 'No agent produced output.',
    citations: dedupeCitations(allCitations),
    fields: allFields.length > 0 ? dedupeFields(allFields) : undefined,
    needsHumanReview: dedupeReview(allReview),
    trace,
    approved: false,
  };

  // Must-happen ordering: the gate is the LAST step before returning.
  const result = requireHumanApproval(draft, task.approved === true);

  // Continuous learning: only AFTER the gate passes do we remember the cited finding.
  await rememberApprovedFindings(result);

  return result;
}
