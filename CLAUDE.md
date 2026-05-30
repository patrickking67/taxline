# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Taxline** — agentic tax operations. A fleet of five AI agents (Intake, Extraction, Research, Workpaper, Compliance) works behind an orchestrator to remove manual tax operations for firms, businesses, and solo preparers, **while preserving human approval**. The product reads like a live operations console: queues, agent activity, extraction confidence, citation-backed evidence, compliance deadlines.

Product principle: **the end users are accountants — the product is GUI-first, never a CLI.** A human approves before any output ships. Never market it as "replace accountants" or "fully autonomous".

## Monorepo layout

```
site/            Astro 5 static site — marketing + the product app shell (the GUI)
service/         Node + TypeScript agent fleet (Anthropic SDK) — the backend
knowledge-base/  Markdown corpus (tax/ + practices/) + manifest.json + ingest/  the agents retrieve over
workers/contact/ Cloudflare Worker — the demo/contact form backend
.github/workflows/  deploy.yml (→ GitHub Pages) + ci.yml
docs/            design.md (spec), design-contract.md (page-build rules)
.claude/         launch.json (dev servers), rules/ (always-on conventions)
```

`site/` is the primary deliverable and the only thing that deploys to GitHub Pages (Pages is **static** — no server runs there). `service/` runs locally / on a Node host and the site talks to it through the adapter layer.

## Commands

- `npm run dev` — Astro dev server on **:4321** (root proxies to `site`). Use `preview_start` / the launch.json entry; don't make users run commands.
- `npm run build` — static build → `site/dist` (fingerprinted assets in `_assets/`).
- `npm run check` — `astro check` (typecheck `.astro`).
- `npm run lint` / `npm run typecheck` / `npm run format` — eslint (flat config) · site+service+worker typecheck · prettier.
- Service: `cd service && npm install && npm run dev` (needs `service/.env` → `ANTHROPIC_API_KEY`; offline-deterministic without it). Serves **:8787**.
- Deploy: the site is GitHub Actions → Pages on push to `main` (set `BASE_PATH=/taxline` for a project page, `/` for a custom domain); the fleet ships as a container via root `Dockerfile`/`fly.toml` (`fly deploy`); the contact Worker via `wrangler deploy`. Full runbook: `docs/system-design.md`.

## Architecture that spans files

- **Design tokens are the source of truth.** `site/src/styles/global.css` `@theme` mirrors `docs/` design tokens (graphite shell, warm-white text, one green accent `#3da57b`, warm "paper" surface for documents, 8px max radius, IBM Plex Sans/Mono). Reuse the tokens + components; never invent colors. Full rules: `docs/design-contract.md` and `.claude/rules/design-system.md`.
- **Components compose; primitives are shared.** `StatusPill`, `ConfidenceMeter`, `EvidenceChip`, `AgentCard`, `Button`, `Logo` are reused across the marketing site, the `ConsoleHero`, and the product app (`components/app/AppShell.astro`). Change a primitive once.
- **The backend boundary is the adapter layer.** `site/src/lib/api/` has two seams, both defaulting to an offline mock: **`fleet`** (queue/doc/run/memory — `mockFleet` → `serviceFleet` via `PUBLIC_SERVICE_ENDPOINT`) and **`api`** (contact form — `mock` → `cloudflare` via `PUBLIC_CONTACT_ENDPOINT`). `mockFleet` simulates the orchestrator + human-approval gate fully client-side, so the app works on static Pages. Any backend honoring the same contract drops in (Azure Functions / Supabase / Formspree). The site never assumes a server exists.
- **Agent fleet (`service/`)** follows fixed principles — see `.claude/rules/agent-architecture.md`: agentic loop on `stop_reason`; hub-and-spoke orchestrator; isolated agent context; structured errors (`errorCategory`/`isRetryable`); a **programmatic** `requireHumanApproval` gate (not a prompt); nullable tool-output fields to prevent fabrication; provenance + confidence preserved; confidence `<0.85` routes to human review.
- **Knowledge base** is retrieved over by the Research agent (`service/src/kb/retrieve.ts`), which delegates to the **vector memory** (`service/src/memory/`, cosine over a persistent flat-file store) with a dependency-free keyword fallback when the store is empty. Tax figures are **domain-knowledge seeds flagged for source verification**; `knowledge-base/ingest/refresh.ts` re-reviews + content-hashes each source (the live-refresh path).

## Security boundaries

- No autonomous filing. No training on client data. Documents stay in the workspace; nothing ships unreviewed.
- Honeypot + email validation on the contact form (mock adapter + Worker). Secrets only in `.env` / Wrangler secrets / Actions secrets — never committed.
- **Attribution:** commits use only the user's git identity. Never add Claude/Anthropic/AI/bot as author, co-author, committer, trailer, reviewer, or in any file. No "generated with" notes.
