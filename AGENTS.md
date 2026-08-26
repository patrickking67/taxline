# Repository agent instructions

Canonical instructions for every coding agent working in this repository
(Claude Code, Cursor, GitHub Copilot, Codex). Vendor files are thin adapters
that point here — never duplicate this content into them.

## What this is

**Taxline** — agentic tax operations. A fleet of five AI agents (Intake, Extraction,
Research, Workpaper, Compliance) works behind an orchestrator to remove manual tax
operations for firms, businesses, and solo preparers, **while preserving human
approval**. The product reads like a live operations console: queues, agent activity,
extraction confidence, citation-backed evidence, compliance deadlines.

Product principle: **the end users are accountants — the product is GUI-first, never
a CLI.** A human approves before any output ships. Never market it as "replace
accountants" or "fully autonomous".

## Repository map

```
site/               Astro 5 static site — marketing + the product app shell (the GUI)
service/            Node + TypeScript agent fleet (Anthropic SDK) — the backend
knowledge-base/     Markdown corpus (tax/ + practices/) + manifest.json + ingest/
workers/contact/    Cloudflare Worker — the demo/contact form backend
docs/               design.md (spec), design-contract.md, system-design.md
.github/workflows/  deploy.yml (→ GitHub Pages) + ci.yml
.claude/            launch.json (dev servers), rules/ (always-on conventions)
```

`site/` is the primary deliverable and the only thing that deploys to GitHub Pages
(Pages is **static** — no server runs there). `service/` runs locally or on a Node
host, and the site talks to it through the adapter layer.

## Setup and validation

```bash
npm install            # root (installs the site workspace + lint toolchain)
npm run dev            # Astro dev server → http://localhost:4321
npm run dev:service    # agent fleet     → http://localhost:8787
npm run build          # static build    → site/dist (fingerprinted assets in _assets/)
npm run check          # astro check (typecheck .astro)
npm run typecheck      # site + service + worker typecheck
npm run lint           # eslint (flat config)
npm run format         # prettier --write
npm run refresh-kb     # re-review the knowledge base + restamp the manifest
```

`service/` and `workers/contact/` have their own dependencies — run `npm install`
inside each. The service needs `service/.env` → `ANTHROPIC_API_KEY`; without it the
fleet stays offline-deterministic.

**Full validation before completion:** `npm run check && npm run lint && npm run typecheck`

## Deployment

- Site: GitHub Actions → Pages on push to `main`. Set `BASE_PATH=/taxline` for a
  project page, `/` for a custom domain.
- Fleet: container via the root `Dockerfile` / `fly.toml` (`fly deploy`).
- Contact Worker: `wrangler deploy`.
- Full runbook: `docs/system-design.md`.

## Architecture that spans files

- **Design tokens are the source of truth.** `site/src/styles/global.css` `@theme`
  mirrors the `docs/` design tokens: graphite shell, warm-white text, one green
  accent (`#3da57b`), warm "paper" surface for documents, ≤8px radius, borders not
  shadows, IBM Plex Sans/Mono. Use the Tailwind utilities; never hardcode hex. Reuse
  the primitives (`StatusPill`, `ConfidenceMeter`, `EvidenceChip`, `AgentCard`,
  `Button`, `Logo`) — change a primitive once. Full rules: `docs/design-contract.md`
  and `.claude/rules/design-system.md`.
- **Components compose; primitives are shared.** The same primitives back the
  marketing site, the `ConsoleHero`, and the product app
  (`components/app/AppShell.astro`).
- **The backend boundary is the adapter layer.** `site/src/lib/api/` has two seams,
  both defaulting to an offline mock: **`fleet`** (queue/doc/run/memory — `mockFleet`
  → `serviceFleet` via `PUBLIC_SERVICE_ENDPOINT`) and **`api`** (contact form —
  `mock` → `cloudflare` via `PUBLIC_CONTACT_ENDPOINT`), selected with
  `PUBLIC_API_ADAPTER`. `mockFleet` simulates the orchestrator and the human-approval
  gate fully client-side, so the app works on static Pages. Any backend honoring the
  same contract drops in. **The site never assumes a server exists.**
- **Agent fleet principles** (`.claude/rules/agent-architecture.md`): agentic loop on
  `stop_reason`; hub-and-spoke orchestrator; isolated agent context; structured errors
  (`errorCategory` / `isRetryable`); a **programmatic** `requireHumanApproval` gate
  (not a prompt); nullable tool-output fields to prevent fabrication; provenance and
  confidence preserved; confidence `<0.85` routes to human review.
- **Knowledge base** is retrieved over by the Research agent
  (`service/src/kb/retrieve.ts`), which delegates to the **vector memory**
  (`service/src/memory/`, cosine over a persistent flat-file store) with a
  dependency-free keyword fallback when the store is empty. Tax figures are
  **domain-knowledge seeds flagged for source verification**;
  `knowledge-base/ingest/refresh.ts` re-reviews and content-hashes each source.

## Voice

Short, certain, technical. Sentence case. No emoji. Quantify with confidence
percentages and dates.

## Security boundaries

- No autonomous filing. No training on client data. Documents stay in the workspace;
  nothing ships unreviewed.
- Honeypot and email validation on the contact form (mock adapter + Worker).
- Secrets only in `.env` / Wrangler secrets / Actions secrets — never committed.
- **Attribution:** commits use only the repository owner's git identity. Never add
  Claude, Anthropic, an AI, or a bot as author, co-author, committer, trailer,
  reviewer, or in any file. No "generated with" notes.

## AI configuration maintenance

- This `AGENTS.md` is canonical. Update it only when durable repository knowledge
  changes, then re-sync the thin adapters (`CLAUDE.md`,
  `.github/copilot-instructions.md`).
- Use repository-shared files and remote HTTPS MCP servers only.
- Never commit `CLAUDE.local.md`, `.claude/settings.local.json`, or machine paths.

## Definition of done

- Requested behavior is complete.
- `npm run check`, `npm run lint`, and `npm run typecheck` pass.
- Security and error paths were reviewed.
- Durable documentation and instructions are current.
- Commands run and unresolved risks are reported.
