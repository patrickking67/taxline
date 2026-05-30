# Prompting techniques

Distilled engineering practice. How the fleet's instructions and tool calls are written.

## Six techniques

1. **Be clear and direct.** State the task, the audience, and the desired output plainly.
   Ambiguity is the main cause of bad output.
2. **Give context and a role.** Tell the model who it is and why the task matters (e.g.
   "You are the Extraction agent; surface uncertainty honestly").
3. **Use examples (few-shot).** Show one or more input→output pairs. Examples constrain
   format and behavior far more reliably than adjectives. A couple of well-chosen
   examples usually beat a paragraph of instructions.
4. **Let the model think (structured reasoning).** For multi-step work, allow the model to
   reason before answering; for tool use, let it decide which tool fits the step.
5. **Constrain the output.** Specify structure — and for machine consumption, enforce it
   with a tool/JSON schema rather than asking for JSON in prose.
6. **Prefill / steer.** Start the answer or fix its shape so the model continues in the
   intended format (e.g. begin a JSON object, or set a heading).

## Few-shot, concretely

Provide examples that mirror the real distribution, including a hard/edge case. For
extraction, include an example where a field is genuinely unreadable and the correct
output is `null` — this teaches the model to abstain rather than fabricate.

## Structured output

Define the exact schema. Make uncertain fields **nullable/optional** so the model returns
`null` instead of inventing a value. Carry a **confidence** per field and **provenance**
(which source each value came from). Validate the structure in code; route low-confidence
fields to a human. This is prompting and architecture meeting in the middle.
