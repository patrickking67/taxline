# Taxline "spin it up" — build spec

_2026-05-30 · approved by Patrick King (CTO)_

## Goal

Take Taxline from a polished marketing site + an unwired backend to a **fully
functional, deploy-ready product**: the GUI talks to the agent fleet, the backend
is runnable locally and shippable to a real host, the knowledge base is fuller,
the repo carries best-practice tooling, and the system is documented end to end.

## Context

- `site/` (Astro 5, static) is the GUI + marketing. Deploys to GitHub Pages.
- `service/` (Node + Anthropic SDK) is the 5-agent fleet behind an orchestrator
  with a programmatic human-approval gate and a persistent vector memory. Sound
  architecture; **not wired to the GUI** and has **no run/deploy artifacts**.
- `workers/contact/` is the demo-form Worker. `knowledge-base/` is the corpus.
- The frontend↔backend seam is `site/src/lib/api/` — today only `submitDemo`.

## Decisions (locked)

1. **Backend**: make it production-ready (Docker + Fly) and run it locally for a
   live view. Runs live with an `ANTHROPIC_API_KEY`, deterministic-offline without.
2. **Ship**: explicit go-ahead to deploy — commit to `main` (→ Pages) and deploy
   the Worker after local verification. Fly service deploy handed off as one
   command (needs the owner's account). Commits use the owner's git identity only.
3. **Demo**: both — fully interactive on static Pages via a mock adapter, AND
   live-wired to the service when `PUBLIC_API_ADAPTER`/endpoint point at it.

## Workstreams & acceptance

1. **Cleanup + tooling** — `AGENTS.md`, `.editorconfig`, `.nvmrc`, `.gitattributes`,
   `.vscode/`, root ESLint(flat)+Prettier with real `npm run lint`, `.github/`
   (dependabot, issue/PR templates, CODEOWNERS = owner only), CI/deploy Node 20→22 +
   service/worker typecheck, `npm audit` fixes. Fix `solutions.astro` `products`→`product`
   and the stale `Development/taxline` path. **Accept:** `build` + `check` clean; `lint` runs.
2. **Backend runnable** — `service/Dockerfile`, `.dockerignore`, `fly.toml` (volume on
   `.data/`). **Accept:** `service` starts locally; `/health`, `/queue`, `/agents/run`,
   `/memory/search` respond; `typecheck` clean.
3. **Adapter** — `FleetService` (`health·queue·doc·run·memorySearch`) with `mockFleet`
   + `serviceFleet(endpoint)`, resolved by env. **Accept:** app reads adapter; mock works
   with no backend; live works when pointed at the service.
4. **Functional demo** — "Run the fleet" panel exercising the real approval gate;
   fill the 404 app sub-pages; activate inert controls. **Accept:** every sidebar link
   resolves; the gate (withheld draft → approve → shipped) works on Pages.
5. **Knowledge base** — +4 source-flagged entries; manifest updated; `ingest/refresh.ts`
   computes+stores a content hash. **Accept:** `refresh-kb` runs; new files indexed.
6. **System design** — `docs/system-design.md` (context/container/deploy diagrams, data
   flow, trust boundaries, scaling, runbook). **Accept:** committed, accurate to code.
7. **Verify + deploy** — local build/check/typecheck + dev-server exercise + screenshot;
   then commit→`main`, deploy Worker, hand off Fly. **Accept:** Pages live; Worker live.

## Non-goals

No autonomous filing. No real client data. No new product surfaces beyond the demo
shell. No design-system changes (tokens/components are the source of truth).
