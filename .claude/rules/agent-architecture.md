# Always-on rule — agent fleet architecture (scope: service/)

Distilled from AI-fluency + agentic best practice. Apply when building or changing the fleet.

- **Agentic loop on `stop_reason`.** `tool_use` → run the tool, append the `tool_result`, loop; `end_turn` → done. Never decide stopping by parsing natural-language text; never use an iteration cap as the *primary* stop (a high backstop is fine).
- **Hub-and-spoke.** The orchestrator owns decomposition, routing, error handling, and aggregation. Agents have **isolated context** — pass everything they need explicitly. Right-size tools per agent (least privilege); clear, distinct tool descriptions are the primary selection mechanism.
- **Deterministic where it matters.** Must-happen steps are **programmatic gates/hooks**, not prompt instructions. `requireHumanApproval` blocks final output until a person approves — nothing ships unreviewed.
- **Structured errors.** Return `{ errorCategory: transient|validation|business|permission, isRetryable, message }`. Distinguish access-failure from valid-empty-result. Never silently swallow; never terminate the whole run on one tool failure.
- **Don't fabricate.** Tool/output schemas use nullable/optional fields so the model returns `null` instead of inventing values. Preserve provenance (claim → source) and per-field confidence through synthesis; route confidence `<0.85` to human review.
- **Models.** `claude-haiku-4-5` for classify/intake; `claude-opus-4-8` (or `claude-sonnet-4-6`) for research/workpaper. Batches API (50% cheaper, ≤24h, no multi-turn tool calling) for overnight jobs only — never for interactive paths.
- **Knowledge base.** Research retrieves over `knowledge-base/`; answers are citation-backed, never freeform guesses. Tax figures are seeds flagged for verification; treat `ingest/` as the live-source path.
