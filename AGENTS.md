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
site/               Astro 7 static site — marketing, free calculators (/tools), the product app shell (the GUI)
packages/tax-engine/ Deterministic federal tax math (TY2026) + scenario validation, shared by site + service
service/            Node + TypeScript agent fleet (Anthropic SDK) — the backend
cms/                EmDash CMS (Astro 7, own lockfile) for Insights; NOT a root workspace
scripts/            pull-insights.mjs — CMS export → site/src/content/insights.json
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
npm run dev:cms        # EmDash CMS      → http://localhost:4322/_emdash/admin (cd cms && npm install && npm run seed first)
npm run pull-insights  # EMDASH_URL=… pulls published Insights into the site snapshot (no-op without it)
npm run build          # static build    → site/dist (fingerprinted assets in _assets/)
npm run check          # astro check (typecheck .astro)
npm run typecheck      # site + tax-engine + service + worker typecheck
npm test               # tax-engine unit tests (node:test via tsx)
npm run test:e2e       # Playwright + axe against the production build under /taxline
npm run lint           # eslint (flat config)
npm run format         # prettier --write
npm run refresh-kb     # re-review the knowledge base + restamp the manifest
```

`service/`, `cms/`, and `workers/contact/` have their own dependencies — run `npm install`
inside each. The service needs `service/.env` → `ANTHROPIC_API_KEY`; without it the
fleet stays offline-deterministic.

**Full validation before completion:** `npm run check && npm run lint && npm run typecheck && npm test`
(plus `npm run test:e2e` for any site change; set `CHROMIUM_PATH` to use an existing Chromium).

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
- **The math is code, never a prompt.** `packages/tax-engine` holds every tax
  computation (Form 1040 path, Schedule SE, §6654 safe harbor, §179/bonus/MACRS,
  practice ROI). Indexed figures live only in `src/years/2026.ts`, each cited to
  Rev. Proc. 2025-32 / SSA / Pub 946 — add a year as data, not code. Every result is a
  `Trace` (value, operands, form line, authority). The site's `/tools/*` calculators
  import it directly; the Workpaper agent reaches it through the `compute_tax` tool
  (`service/src/tools/tax-calc.ts`, imported by relative path; the Dockerfile copies
  `packages/tax-engine/src`). Test expectations are worked by hand from the IRS
  tables, never copied from engine output.
- **AI intake is validated in code.** `POST /scenario` (service) asks Claude, via one
  tool with nullable fields, for each figure plus an exact evidence quote;
  `validateScenario` (engine) then checks key, type, that the quote is in the input, and
  that it states the amount. Failures are capped at 0.5 confidence with a reason, never
  dropped. `mockFleet.scenario` runs the deterministic `extractScenario` with the same
  validator. The UI (`components/tools/ScenarioIntake.astro`) applies only fields the
  person checks; fields under 0.85 start unchecked.
- **EmDash is the CMS; the site stays static.** `cms/` is a separate EmDash app (Astro 7,
  React, SQLite locally, D1/R2 on Cloudflare) because EmDash needs a server
  runtime. It exports published Insights at `/api/insights.json`;
  `scripts/pull-insights.mjs` validates and atomically writes the committed snapshot the
  site builds from. The deploy pulls only when the `EMDASH_URL` repository variable is set
  and continues on failure. Schema of record: `cms/seed/seed.json`.
- **The deployed shape is tested, not assumed.** `site/e2e/` runs Playwright against the
  production build served under `/taxline` (`e2e/serve.mjs` mimics Pages, including the 404).
  It walks the sitemap: one `<h1>`, canonical, valid JSON-LD, no console errors or failed
  requests, no serious/critical axe WCAG 2.1 AA violations, and every internal link resolves.
  Calculator specs assert hand-worked figures on screen. Text tokens must hold ≥4.5:1 on
  every surface; prose links are underlined.
- **SEO lives in `Base.astro` + `lib/seo.ts`.** Canonical/OG/Twitter tags and one JSON-LD
  `@graph` per page (pages pass extra nodes via `schema`). `sitemap.xml`, `robots.txt`,
  and `llms.txt` are generated endpoints in `site/src/pages/`; the sitemap derives from
  the pages directory and excludes `app/*` (the demo app is `noindex`).
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
