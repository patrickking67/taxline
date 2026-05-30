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

| Method | Path             | Purpose                                                        |
|--------|------------------|----------------------------------------------------------------|
| GET    | `/health`        | Liveness, model IDs, agent list, memory snapshot, posture.     |
| GET    | `/queue`         | Intake-queue summary (mirrors the site's `AppDoc` shape).      |
| GET    | `/doc/:id`       | One document with full fields + evidence.                      |
| POST   | `/agents/run`    | `{ task, agent?, docId?, approved?, maxHops? }` → gated result.|
| POST   | `/demo`          | Demo-request intake (honeypot + email check), like the site.   |
| POST   | `/memory/index`  | Rebuild the vector memory from the KB (idempotent).            |
| POST   | `/memory/remember` | `{ text, source? }` → append one finding to continuous memory. |
| GET    | `/memory/search` | `?q=&k=` → cosine top-k over the vector memory.                |

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

`../knowledge-base/` holds the living KB. It is chunked by heading and embedded into the
**vector memory** (below); `src/kb/retrieve.ts` is now a thin delegate that embeds the
query and cosine-searches that store. If the store is empty (index not built yet), it
falls back to the original dependency-free keyword/overlap scoring, so retrieval always
works with zero setup. `manifest.json` tracks sources and a monthly refresh cadence; tax
figures are flagged `verify: true` because exact dates/amounts must be confirmed against
the live IRS source. `../knowledge-base/ingest/refresh.ts` is the seam where live source
fetching plugs in.

## Memory

The service has a **persistent, continuous, vector** memory layer (`src/memory/`):

- **Vector** — text is turned into embeddings and retrieved by **cosine similarity**, not
  keyword matching. `src/memory/embeddings.ts` picks a provider from `EMBEDDINGS_PROVIDER`:
  - `local` (default) — a deterministic, **dependency-free, offline** pseudo-embedding:
    it tokenizes, hashes tokens + 2-grams into a fixed **512-dim** bucketed vector, and
    L2-normalizes. Stable across runs, no network, no install. It captures **lexical
    overlap only** — fine for dev/offline, not real semantics.
  - `voyage` — Voyage AI (`voyage-3`), `VOYAGE_API_KEY`. Real semantic quality.
  - `openai` — OpenAI (`text-embedding-3-small`), `OPENAI_API_KEY`. Real semantic quality.
- **Persistent** — `src/memory/store.ts` is a flat-file vector store at
  **`.data/memory.json`** (the dir is created on first write; it is gitignored). Every
  write is atomic-ish (temp file + rename) so a crash can't corrupt it, and it survives
  restarts. On a host this lives on a **persistent volume** so memory isn't lost on deploy.
- **Continuous** — `src/memory/index.ts` exposes `indexKnowledgeBase()` (embed + upsert
  the KB, idempotent by `hash(file+heading)`), `retrieve(query, k)` (embed + cosine top-k),
  and `remember(text, source)` (embed + append a single finding). The orchestrator calls
  **`remember()` only after the human-approval gate passes** — and only for cited findings
  with no open review items — so approved work flows back into memory and future
  retrievals build on it. Unapproved drafts and low-confidence content are never
  remembered.

On startup the server builds the index automatically if the store is empty
(`POST /memory/index` rebuilds it on demand). **Switching providers** is config-only: set
`EMBEDDINGS_PROVIDER` + the matching key, then `POST /memory/index` to re-embed the KB
with the new provider (stored vectors must come from one provider at a time).

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

## Deploy (fly high)

Run this as an **always-on Node service on [Fly.io](https://fly.io)**. It is a long-lived
HTTP process with a continuously-growing on-disk memory store, so it needs a real host —
it **cannot** run on GitHub Pages or Cloudflare Pages (static assets only), and the
persistent memory rules out a stateless edge function without external storage.

1. **App + machine** — `fly launch` (Node app, `npm run start` as the start command, or a
   small Dockerfile around `node`). Keep at least one machine running so the index stays
   warm and memory is in process; the server auto-builds the index on first boot.
2. **Persistent volume for `.data/`** — create a volume and mount it at the service's
   `.data/` directory so **`.data/memory.json` survives restarts and redeploys**:

   ```bash
   fly volumes create taxline_data --size 1
   # fly.toml:
   # [mounts]
   #   source = "taxline_data"
   #   destination = "/app/.data"
   ```

   Without the volume, every deploy starts from an empty store and re-indexes the KB,
   losing all `remember()`'d findings. With it, continuous memory persists.
3. **Secrets** — set `ANTHROPIC_API_KEY` and the embeddings key for your provider:

   ```bash
   fly secrets set ANTHROPIC_API_KEY=sk-ant-...
   fly secrets set EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=...   # or openai/OPENAI_API_KEY
   # local (default) needs no key and works fully offline.
   ```

   Also set `SITE_ORIGIN` (your site's origin, for CORS) and optionally `PORT`. After a
   provider change, `POST /memory/index` once to re-embed the KB with the new provider.
4. **Wire the site** — the static site calls this backend through **`site/src/lib/api`**:
   set `PUBLIC_API_ADAPTER` (and the deployed endpoint URL) at build time so the demo form
   and the app's queue/extraction/memory reads hit the Fly service instead of the mock.

### Posture

- **Human approval before output ships** — enforced programmatically, not by prompt.
- **No training on customer data** — the service sends task data to the model only to
  perform the requested work; it is not used to train models. Treat all document data as
  confidential and least-privilege throughout.
