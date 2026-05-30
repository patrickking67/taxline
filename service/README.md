# @taxline/service

The Taxline agent backend: a **5-agent fleet behind an orchestrator**, with a
retrieval-backed **living knowledge base**. Agentic, but **never autonomous end to end** —
a human approves before any output ships, and every field carries a confidence score and a
citation.

## What it is

Five narrow, tool-using agents (hub-and-spoke, with the orchestrator as the hub):

| Agent        | Job                                          | Tools (least privilege)        | Model               |
|--------------|----------------------------------------------|--------------------------------|---------------------|
| **Intake**   | Classify a document and route it             | `classify_document`, `kb_search` | `claude-haiku-4-5` (fast) |
| **Extraction** | Pull fields with confidence + citations    | `extract_fields`, `assess_confidence` | `claude-opus-4-8` |
| **Research** | Citation-backed answers from the KB          | `kb_search`, `format_citations` | `claude-opus-4-8` |
| **Workpaper** | Assemble a reviewer-ready workpaper         | `kb_search`, `format_citations` | `claude-opus-4-8` |
| **Compliance** | Deadlines + follow-up                      | `compute_deadline`, `kb_search` | `claude-opus-4-8` |

The **orchestrator** owns decomposition, routing, error handling, and aggregation, and it
applies a **programmatic human-approval gate** (`requireHumanApproval`) before returning
any shippable output. Nothing about stopping is decided by parsing prose — the agentic
loop is driven entirely by `stop_reason` (`tool_use` → run tools and loop; `end_turn` →
done), with a high iteration cap only as a backstop.

### Architecture principles (baked in)

- **stop_reason loop** — `src/agent.ts` (`runAgent`).
- **Hub-and-spoke** — `src/orchestrator.ts`; agents never call each other.
- **Structured errors** — `{ errorCategory, isRetryable, message }` everywhere (`src/types.ts`);
  access-failure vs. valid-empty-result are distinct.
- **Programmatic gate** — `requireHumanApproval` in `src/orchestrator.ts`, enforced as the
  last step (must-happen ordering in code).
- **Structured output** — JSON-schema tools with **nullable** fields so the model returns
  `null` instead of fabricating; provenance (claim → source) + confidence preserved;
  fields below **0.85** routed to human review.
- **Least privilege** — each agent gets only the tools its role needs; tool **descriptions**
  are the primary tool-selection mechanism.

## Run it

```bash
cd service
cp .env.example .env          # then put your key in .env (ANTHROPIC_API_KEY=...)
npm install
npm run dev                   # tsx watch src/server.ts  (http://localhost:8787)
```

- Without a key, the service runs in **offline mode**: each agent does a deterministic,
  clearly-labeled tool run so every endpoint is exercisable with no API access. The output
  says so — it is a degraded mode, not a silent fabrication.
- `npm run start` runs once (no watch). `npm run typecheck` runs `tsc --noEmit`.
- `npm run refresh-kb` re-reads the knowledge base and stamps `manifest.updatedAt`.

The API key is read from `.env` via `dotenv` at startup — it is **never** hardcoded.

## Endpoints

| Method | Path           | Purpose                                                        |
|--------|----------------|----------------------------------------------------------------|
| GET    | `/health`      | Liveness, model IDs, agent list, posture (no secrets).         |
| GET    | `/queue`       | Intake-queue summary (mirrors the site's `AppDoc` shape).      |
| GET    | `/doc/:id`     | One document with full fields + evidence.                      |
| POST   | `/agents/run`  | `{ task, agent?, docId?, approved?, maxHops? }` → gated result.|
| POST   | `/demo`        | Demo-request intake (honeypot + email check), like the site.   |

`POST /agents/run` returns `{ output, citations[], fields?, needsHumanReview[], trace[], approved }`.
Until `approved: true` is passed, `output` is the **withheld draft** and `needsHumanReview`
includes "human approval required before shipping".

CORS is restricted to `SITE_ORIGIN` (default `http://localhost:4321`).

Quick check (offline mode is fine):

```bash
curl localhost:8787/health
curl localhost:8787/queue
curl -X POST localhost:8787/agents/run -H 'content-type: application/json' \
  -d '{"task":"Classify and extract acme_w2_2024","docId":"acme_w2_2024"}'
```

## Knowledge base

`../knowledge-base/` holds the living KB. `src/kb/retrieve.ts` loads all markdown, chunks
by heading, and scores chunks against a query with simple keyword/overlap scoring — **no
external vector DB or embeddings**. `manifest.json` tracks sources and a monthly refresh
cadence; tax figures are flagged `verify: true` because exact dates/amounts must be
confirmed against the live IRS source. `../knowledge-base/ingest/refresh.ts` is the seam
where live source fetching plugs in.

## Production plan

This is a **Node / agent service** — it makes server-side calls to the Anthropic API and
reads the filesystem. It **cannot** run on GitHub Pages or Cloudflare Pages, which serve
**static** assets only. Deploy options:

1. **Node service (recommended)** — ship the same code to **Fly.io**, **Render**, or any
   container host (`npm run start`, or a small Dockerfile around it). Set `ANTHROPIC_API_KEY`,
   `PORT`, and `SITE_ORIGIN` as environment variables / secrets. The KB ships alongside the
   code; the refresh job runs on a schedule (the monthly cadence in the manifest).
2. **Cloudflare Workers (tool-light path)** — port the **tool-light** calls (classification,
   single-shot research/answers) to a Worker that calls the **Messages API** directly. The
   filesystem KB becomes KV/R2/D1-backed retrieval (or a small vector index), since Workers
   have no local fs. Long multi-hop agentic loops are better on a Node host or a Durable
   Object; keep the heavy orchestration off the edge.

Either way, the static site talks to this backend through **`site/src/lib/api`**: set
`PUBLIC_API_ADAPTER` (and the endpoint URL) at build time so the adapter points the demo
form — and the app's queue/extraction reads — at the deployed service instead of the mock.

### Posture

- **Human approval before output ships** — enforced programmatically, not by prompt.
- **No training on customer data** — the service sends task data to the model only to
  perform the requested work; it is not used to train models. Treat all document data as
  confidential and least-privilege throughout.
