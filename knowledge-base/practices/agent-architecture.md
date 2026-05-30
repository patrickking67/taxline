# Agent architecture principles

Distilled engineering practice — the principles the Taxline service is built on. These
are the same ideas referenced in the service's code comments.

## The agentic loop is driven by stop_reason

Run the model, inspect `stop_reason`:
- `tool_use` → execute the requested tool(s), append a `tool_result` for each, and loop.
- `end_turn` → the model is done; return its answer.

Never parse the model's natural-language output to decide when to stop. Never use an
iteration count as the **primary** stop condition — a high iteration cap is acceptable
only as a backstop against a pathological loop. The loop's correctness comes from
honoring `stop_reason`.

## Hub-and-spoke orchestration

A single **orchestrator** owns decomposition, routing, error handling, and aggregation.
**Agents are spokes**: each has isolated context, receives an explicit task input, and
does one narrow job. Agents do not call each other; the orchestrator routes between them
(including following declared handoffs). This keeps context clean and failures contained.

## Structured errors

Tool/agent failures return a structured shape, never a bare "failed":
`{ errorCategory: 'transient' | 'validation' | 'business' | 'permission', isRetryable, message }`.
- **transient** — IO/network/rate; retryable.
- **validation** — bad input; fix the input.
- **business** — a rule says no (e.g. unsupported form); not retryable as-is.
- **permission** — not allowed / not granted; not retryable.

Distinguish an **access failure** (could not look) from a **valid empty result** (looked,
found nothing). They demand different handling.

## Programmatic gates

Critical guarantees are enforced in **code**, not by asking the model nicely. Taxline's
`requireHumanApproval` function blocks final "ship" output until a human approves, and the
must-happen ordering (gate is the last step) is enforced by the orchestrator.

## Isolated subagent context

Each agent sees only its task and the context the orchestrator hands it — not the whole
conversation. Isolation reduces cross-talk, keeps prompts focused, and makes each agent
independently testable.

## Tool descriptions as the primary selection mechanism

The model picks tools mainly from their **descriptions**, so each description must be
clear and distinct from its siblings. Give each agent only the tools its role needs
(**least privilege**): fewer, well-described tools select better and limit blast radius.

## Nullable fields, provenance, confidence → human routing

Structured tool output uses a JSON schema with **nullable/optional** fields so the model
returns `null` instead of fabricating. Every claim carries **provenance** (claim → source)
and a **confidence** score. Fields below the confidence threshold (Taxline uses 0.85) are
routed to **human review** rather than shipped.
