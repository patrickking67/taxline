// The agent abstraction and the agentic loop.
//
// `defineAgent` is a tiny in-house factory: an agent is a name, a system prompt,
// a model, a least-privilege set of tools, and an optional handoff target. It owns
// NO orchestration — the orchestrator decides routing. This keeps each agent's
// context isolated and its responsibilities narrow (hub-and-spoke).
//
// `runAgent` is the loop. It is driven entirely by `stop_reason`:
//   - 'tool_use'  -> run the requested tool(s), append tool_result blocks, loop.
//   - 'end_turn'  -> the agent is done; return its final text.
// We NEVER parse the model's prose to decide when to stop, and we NEVER use an
// iteration count as the PRIMARY stop. A high max-iteration cap exists only as a
// backstop against a pathological loop.

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, hasApiKey } from './config.js';
import type { AnyTool, ToolResult, Citation, AgentStep } from './types.js';

export interface AgentDefinition {
  name: string;
  instructions: string;
  model: string;
  tools: AnyTool[];
  /** Name of the agent to hand off to after this one finishes, if any. */
  handoff?: string | null;
}

/** Identity factory — validates and returns the definition. */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  if (!def.name) throw new Error('defineAgent: name is required');
  if (!def.model) throw new Error('defineAgent: model is required');
  return { handoff: null, ...def };
}

/** Backstop only — the loop stops on `end_turn`, not on hitting this number. */
const MAX_ITERATIONS = 12;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

export interface RunAgentInput {
  /** The explicit task this agent receives. Its context is otherwise isolated. */
  task: string;
  /** Optional structured context the orchestrator injects (prior fields, doc, etc). */
  context?: unknown;
}

export interface RunAgentOutput {
  text: string;
  /** Citations surfaced by tools during the run, de-duplicated. */
  citations: Citation[];
  /** Structured tool outputs, keyed for the orchestrator to aggregate. */
  toolOutputs: { name: string; result: ToolResult<unknown> }[];
  step: AgentStep;
  /** True if the loop exited via the backstop rather than a clean end_turn. */
  hitBackstop: boolean;
}

/** Map our tools to the Anthropic tool schema the model sees. */
function toAnthropicTools(tools: AnyTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/** Pull citations out of a structured tool result, wherever they live. */
function harvestCitations(result: ToolResult<unknown>): Citation[] {
  if (!result.ok) return [];
  const data = result.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return [];
  const out: Citation[] = [];
  // kb_search shape: { results: [{ source }] }
  const results = (data as { results?: { source?: Citation }[] }).results;
  if (Array.isArray(results)) {
    for (const r of results) if (r.source) out.push(r.source);
  }
  // extract_fields shape: { fields: [{ citations: [] }] }
  const fields = (data as { fields?: { citations?: Citation[] }[] }).fields;
  if (Array.isArray(fields)) {
    for (const f of fields) if (Array.isArray(f.citations)) out.push(...f.citations);
  }
  return out;
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

/**
 * Run one agent to completion on a task. The orchestrator calls this; the agent
 * never calls another agent itself.
 */
export async function runAgent(agent: AgentDefinition, input: RunAgentInput): Promise<RunAgentOutput> {
  const toolMap = new Map(agent.tools.map((t) => [t.name, t]));
  const citations: Citation[] = [];
  const toolOutputs: { name: string; result: ToolResult<unknown> }[] = [];
  const toolCalls: { name: string; ok: boolean }[] = [];

  // Offline / no-key mode: return a deterministic, clearly-labeled stub so the
  // service and its endpoints are exercisable without a live API key. This is a
  // degraded mode, not a silent fallback — the text says so.
  if (!hasApiKey) {
    const stub = await stubRun(agent, input, toolMap, citations, toolOutputs, toolCalls);
    return {
      text: stub,
      citations: dedupeCitations(citations),
      toolOutputs,
      step: { agent: agent.name, model: agent.model, toolCalls, handoffTo: agent.handoff ?? null },
      hitBackstop: false,
    };
  }

  const anthropic = getClient();
  const userContent =
    input.context !== undefined
      ? `${input.task}\n\nContext:\n${JSON.stringify(input.context, null, 2)}`
      : input.task;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }];
  const tools = toAnthropicTools(agent.tools);

  let finalText = '';
  let hitBackstop = true; // flips to false only on a clean end_turn

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: agent.model,
      max_tokens: 2048,
      system: agent.instructions,
      messages,
    };
    if (tools.length > 0) {
      params.tools = tools;
      // `auto` lets the model decide whether a tool is needed — the description
      // is the primary selection signal. We never force a specific tool here.
      params.tool_choice = { type: 'auto' };
    }
    const response: Anthropic.Message = await anthropic.messages.create(params);

    // Record the assistant turn verbatim so tool_use ids line up with results.
    messages.push({ role: 'assistant', content: response.content });

    // Accumulate any text the model emitted this turn.
    for (const block of response.content) {
      if (block.type === 'text') finalText += block.text;
    }

    // THE STOP DECISION — purely on stop_reason, never on the prose.
    if (response.stop_reason !== 'tool_use') {
      hitBackstop = false;
      break;
    }

    // Run every requested tool and append a matching tool_result block.
    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const tool = toolMap.get(block.name);
      let result: ToolResult<unknown>;
      if (!tool) {
        // Permission/availability error: the model asked for a tool it wasn't
        // granted. Least-privilege violation — report it structurally.
        result = {
          ok: false,
          errorCategory: 'permission',
          isRetryable: false,
          message: `Tool "${block.name}" is not available to agent "${agent.name}".`,
        };
      } else {
        try {
          result = await tool.run(block.input as Record<string, unknown>);
        } catch (err) {
          // An unexpected throw from a tool is treated as transient (retryable).
          result = {
            ok: false,
            errorCategory: 'transient',
            isRetryable: true,
            message: 'Tool threw an unexpected error.',
            detail: err instanceof Error ? err.message : String(err),
          };
        }
      }

      toolOutputs.push({ name: block.name, result });
      toolCalls.push({ name: block.name, ok: result.ok });
      citations.push(...harvestCitations(result));

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        // Flag structured errors so the model can react (retry vs. surface).
        is_error: !result.ok,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  return {
    text: finalText.trim(),
    citations: dedupeCitations(citations),
    toolOutputs,
    step: { agent: agent.name, model: agent.model, toolCalls, handoffTo: agent.handoff ?? null },
    hitBackstop,
  };
}

/**
 * Offline stub run. Exercises the agent's tools deterministically (so the demo
 * works with no API key) and returns a clearly-labeled, non-fabricated summary.
 * This mirrors what the loop would do for one obvious tool call per agent.
 */
async function stubRun(
  agent: AgentDefinition,
  input: RunAgentInput,
  toolMap: Map<string, AnyTool>,
  citations: Citation[],
  toolOutputs: { name: string; result: ToolResult<unknown> }[],
  toolCalls: { name: string; ok: boolean }[],
): Promise<string> {
  const lines: string[] = [`[offline mode — no ANTHROPIC_API_KEY set; deterministic tool run by "${agent.name}"]`];

  const ctx = (input.context ?? {}) as Record<string, unknown>;
  const docId = typeof ctx.docId === 'string' ? ctx.docId : undefined;

  // Pick a representative tool call per agent role so each endpoint returns
  // something coherent without the model in the loop. Awaited so the harvested
  // citations/outputs are populated before we return.
  const tryTool = async (name: string, args: Record<string, unknown>) => {
    const tool = toolMap.get(name);
    if (!tool) return;
    const r = await tool.run(args);
    toolOutputs.push({ name, result: r });
    toolCalls.push({ name, ok: r.ok });
    citations.push(...harvestCitations(r));
  };

  if (toolMap.has('classify_document')) await tryTool('classify_document', { text: docId ?? input.task });
  if (toolMap.has('extract_fields') && docId) await tryTool('extract_fields', { docId });
  if (toolMap.has('kb_search')) await tryTool('kb_search', { query: input.task, k: 3 });
  if (toolMap.has('compute_deadline')) await tryTool('compute_deadline', { form: '1120-S', taxYear: 2024 });

  lines.push(`Task: ${input.task}`);
  lines.push('Set ANTHROPIC_API_KEY in service/.env to run the live agentic loop.');
  return lines.join('\n');
}
