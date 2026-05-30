# AI fluency — the 4Ds and three interaction modes

Distilled engineering practice for working effectively with AI systems. Not tax advice,
and not an answer key — a working method the Taxline fleet is designed around.

## The 4Ds

- **Delegation** — Decide what to hand to the AI vs. keep for a human. Match the task to
  the right capability, and keep judgment calls (and final approval) with people. In
  Taxline, the orchestrator delegates narrow tasks to narrow agents; humans approve.
- **Description** — Tell the system what you want precisely: the goal, the constraints,
  the output shape, and the success criteria. Clear tool descriptions and structured
  output schemas are description applied to agents.
- **Discernment** — Judge the output critically. Check claims against sources, watch for
  fabrication, and treat confidence honestly. Low-confidence results are routed to a
  human rather than waved through.
- **Diligence** — Be accountable and consistent: verify, keep provenance, document
  decisions, and re-check when sources change. The living knowledge base and its refresh
  cadence are diligence applied to retrieval.

## Three interaction modes

- **Automation** — The AI executes a well-specified, repeatable task with little
  ambiguity (e.g. compute a deadline from a rule).
- **Augmentation** — The AI and a human work together; the AI drafts or proposes and the
  human shapes and decides (e.g. an extraction draft a reviewer corrects).
- **Agency** — The AI plans and acts across steps toward a goal, using tools and adapting
  — still bounded by human approval before anything ships. Taxline operates here, with a
  programmatic gate so agency never becomes autonomy.

The Taxline posture: agentic, but never autonomous end to end — a human approves before
output ships.
