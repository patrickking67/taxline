// The orchestrator — the hub in the hub-and-spoke.
//
// It owns: decomposition (which agent starts), routing (following handoffs),
// error handling (acting on structured errors), aggregation (merging citations,
// fields, and review items), and — critically — the PROGRAMMATIC human-approval
// gate that blocks any final "ship" output until a human approves. Agents are
// spokes: isolated context, explicit task input, no agent-to-agent calls.

import { runAgent, type AgentDefinition } from './agent.js';
import { intake } from './agents/intake.js';
import { extraction } from './agents/extraction.js';
import { research } from './agents/research.js';
import { workpaper } from './agents/workpaper.js';
import { compliance } from './agents/compliance.js';
import { memory } from './memory/index.js';
import {
  CONFIDENCE_THRESHOLD,
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
  /** Cap on handoffs followed, as a routing backstop (not the primary stop). */
  maxHops?: number;
}

/**
 * Decomposition: choose the starting agent when one isn't specified. This is the
 * orchestrator's job, not an agent's. Keyword routing keeps it explainable.
 */
function pickEntryAgent(task: string): AgentName {
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

/** Pull review items + fields out of an agent's structured tool outputs. */
function aggregateToolOutputs(
  toolOutputs: { name: string; result: { ok: boolean; data?: unknown } }[],
): { fields: ExtractedField[]; review: ReviewItem[]; errors: StructuredError[] } {
  const fields: ExtractedField[] = [];
  const review: ReviewItem[] = [];
  const errors: StructuredError[] = [];

  for (const { result } of toolOutputs) {
    if (!result.ok) {
      errors.push(result as unknown as StructuredError);
      continue;
    }
    const data = result.data as Record<string, unknown> | undefined;
    if (!data) continue;

    // assess_confidence: { passed[], needsReview[] }
    const passed = (data as { passed?: ExtractedField[] }).passed;
    if (Array.isArray(passed)) fields.push(...passed);
    const needsReview = (data as { needsReview?: ReviewItem[] }).needsReview;
    if (Array.isArray(needsReview)) review.push(...needsReview);

    // extract_fields: { fields[] } — also fold in, flagging low-confidence ones
    // even if assess_confidence wasn't called, so the gate can't be skipped.
    const extracted = (data as { fields?: ExtractedField[] }).fields;
    if (Array.isArray(extracted)) {
      for (const f of extracted) {
        if (f.value == null || f.confidence == null || f.confidence < CONFIDENCE_THRESHOLD) {
          review.push({
            reason:
              f.value == null
                ? 'missing value'
                : f.confidence == null
                  ? 'no confidence score'
                  : `confidence ${f.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`,
            label: f.label,
            value: f.value,
            confidence: f.confidence,
          });
        }
      }
    }
  }
  return { fields, review, errors };
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
 * an agent whose `handoff` is null.
 */
export async function orchestrate(task: OrchestratorTask): Promise<OrchestratorResult> {
  const entry = task.agent ?? pickEntryAgent(task.task);
  const maxHops = task.maxHops ?? 5;

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
    if (!agent) break;

    const run = await runAgent(agent, { task: task.task, context });
    trace.push(run.step);
    allCitations.push(...run.citations);
    if (run.text) outputs.push(`## ${agent.name}\n${run.text}`);

    const agg = aggregateToolOutputs(run.toolOutputs);
    allFields.push(...agg.fields);
    allReview.push(...agg.review);

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

  const draft: OrchestratorResult = {
    output: outputs.join('\n\n') || 'No agent produced output.',
    citations: dedupeCitations(allCitations),
    fields: allFields.length > 0 ? allFields : undefined,
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
