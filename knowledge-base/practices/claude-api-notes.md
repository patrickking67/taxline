# Claude API notes

Distilled engineering reference for building on the Anthropic API.

## Messages API

The Messages API is the core endpoint: send a `system` prompt and a list of `messages`
(alternating `user`/`assistant` turns), get back a message with a `content` array of
typed blocks (`text`, `tool_use`, ...) and a `stop_reason`.

## Tool use loop

1. Send `messages` plus a `tools` array (each tool: `name`, `description`, `input_schema`).
2. If the response `stop_reason` is `tool_use`, find the `tool_use` block(s), run the
   tool(s), and append a `user` message containing a `tool_result` block per call
   (`tool_use_id` + `content`, with `is_error` when the tool failed).
3. Loop until `stop_reason` is `end_turn`.

Honor `stop_reason` to decide stopping — do not parse the prose.

## tool_choice

- `auto` — the model decides whether to call a tool (description-driven selection).
- `any` — the model must call **some** tool this turn.
- `tool` — force a **specific** named tool.

Use `auto` for genuine agency; `any`/`tool` when the step requires a structured action.

## Batches API

The Message Batches API processes many requests asynchronously at roughly **50% lower
cost**, returning within **up to 24 hours**. It is for high-volume, latency-tolerant work.
Note: it does **not** support multi-turn tool-calling loops — use the synchronous Messages
API for interactive agentic loops, and batches for bulk one-shot jobs.

## Model lineup (exact IDs)

- `claude-opus-4-8` — highest accuracy; Taxline's default for extraction, research,
  workpaper, and compliance.
- `claude-sonnet-4-6` — balanced capability/latency.
- `claude-haiku-4-5` — fastest/cheapest; Taxline uses it for classification/triage.

Pick the smallest model that meets the task's accuracy bar; reserve the largest for steps
where correctness dominates.
