# AGENTS.md

Canonical guide for every coding agent in this repo (Claude Code, Codex, Cursor,
Copilot). `CLAUDE.md` and `.github/copilot-instructions.md` only point here.

## What this is

Taxline: agentic tax operations. Five AI agents (Relay intake, Lens extraction,
Atlas research, Ledger workpapers, Sentry compliance) work behind an orchestrator.
Every field carries a confidence score and a citation; under 0.85 it goes to a
person, and a person approves before anything ships. Users are accountants, so the
product is a GUI, never a CLI. Never describe it as "fully autonomous" or as
replacing accountants. It is a portfolio project, not tax advice.

## Layout

```
site/                 Astro 7 static site: marketing, /tools calculators, /app console. Deploys to Pages.
  e2e/                Playwright + axe against the production build under /taxline (serve.mjs mimics Pages)
packages/tax-engine/  Deterministic TY2026 federal math; figures cited in src/years/2026.ts
service/              Node + TypeScript agent fleet (Anthropic SDK), node:http server on :8787
workers/contact/      Cloudflare Worker for the demo form
cms/                  EmDash CMS for Insights (own lockfile, not a root workspace)
knowledge-base/       Markdown corpus the Research agent retrieves over, plus ingest/
scripts/              pull-insights.mjs: CMS export -> site/src/content/insights.json
docs/                 design.md, design-contract.md, system-design.md
.claude/              launch.json (preview servers), rules/ (design system, agent architecture)
```

## Setup

Node `^22.22.3 || ^24.16.0 || >=26.3.0` (`.nvmrc` pins 22). Each package has its own lockfile.

```bash
npm ci && npm --prefix service ci && npm --prefix workers/contact ci && npm --prefix cms ci
(cd site && npx playwright install chromium)     # once, for the e2e suite
```

No API key is needed for anything below. `service/.env` with `ANTHROPIC_API_KEY`
turns on live agents; without it the fleet runs its tools deterministically and
says so in the output. Templates: `service/.env.example`, `site/.env.example`.

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Site dev server | `npm run dev` | http://localhost:4321/ (base `/` in dev) |
| Agent service | `npm run dev:service` | http://localhost:8787/health |
| CMS | `npm run dev:cms` | :4322, run `npm --prefix cms run seed` first |
| Site build | `npm run build` | `site/dist`; set `BASE_PATH=/taxline` for the Pages shape |
| Astro typecheck | `npm run check` | |
| All typechecks | `npm run typecheck` | site, engine, service, Worker |
| Lint | `npm run lint` | ESLint flat config |
| Unit tests | `npm test` | engine, service, Worker (node:test) |
| E2E + axe | `npm run test:e2e` | builds under `/taxline`, serves on :4173; `CHROMIUM_PATH` reuses a local Chromium |
| Everything CI runs | `npm run verify` | lint, typecheck, tests, build, e2e, CMS typecheck + build |
| Quick gate | `npm run verify:fast` | lint, typecheck, tests |
| Refresh root llms.txt | `npm run llms` | copies the built `/llms.txt` to the repo root |
| Format | `npm run format` | Prettier; Markdown is hand-formatted and ignored |

## Preview

`.claude/launch.json` defines `taxline-site` (:4321), `taxline-site-dist` (the
`BASE_PATH=/taxline` build served at http://localhost:4173/taxline/),
`taxline-service` (:8787), and `taxline-cms` (:4322). Start them with the preview
tool rather than asking a person to run them.

## CI and deploy

- `.github/workflows/ci.yml` runs on every push and PR: site check + build, e2e +
  axe, engine tests + typecheck, service tests + typecheck, Worker tests +
  typecheck, lint, CMS typecheck + build. `npm run verify` is the local mirror.
- `.github/workflows/deploy.yml` builds with `BASE_PATH=/taxline` and publishes
  `site/dist` to GitHub Pages on push to `main`. Do not change Pages settings.
- Service: root `Dockerfile` and `fly.toml`. Worker: `wrangler deploy`. Runbook:
  `docs/system-design.md`.

## Conventions

- **Math is code.** All tax computation lives in `packages/tax-engine`. Indexed
  figures live only in `src/years/2026.ts`, each cited (Rev. Proc. 2025-32, SSA, Pub
  946). Results are `Trace` lines (value, operands, form line, authority). Test
  expectations are worked by hand from IRS tables, never copied from engine output.
  Do not change a result without a failing test and a cited rule.
- **The site never assumes a server.** `site/src/lib/api/` has two adapters,
  `fleet` and `api`, both defaulting to offline mocks (`PUBLIC_API_ADAPTER`,
  `PUBLIC_SERVICE_ENDPOINT`, `PUBLIC_CONTACT_ENDPOINT` switch them).
- **Gates are code, not prompts.** The agent loop stops on `stop_reason`; tools are
  least-privilege per agent; errors are structured (`errorCategory`, `isRetryable`);
  `extract_fields` is the source of truth and `assess_confidence` can only add review
  items; every early stop of the chain (error, unknown agent, hop cap) adds a
  review item, and `maxHops` is clamped by `clampMaxHops`; `requireHumanApproval`
  runs last in `service/src/orchestrator.ts`. Rules:
  `.claude/rules/agent-architecture.md`. Service tests use a fake Messages client.
- **Intake is validated.** `POST /scenario` output goes through `validateScenario`
  (known key, typed value, quote present in the text and stating the amount).
- **Design tokens rule the UI.** `site/src/styles/global.css` `@theme` holds them:
  graphite shell, warm-white text, one green accent, IBM Plex, radius 8px or less,
  borders over shadows. Reuse the primitives in `site/src/components/`. Body text
  holds 4.5:1; one entrance animation (the hero), reduced motion respected. Details:
  `docs/design-contract.md`, `.claude/rules/design-system.md`.
- **SEO** lives in `site/src/layouts/Base.astro` and `site/src/lib/seo.ts`;
  `sitemap.xml`, `robots.txt`, and `llms.txt` are endpoints in `site/src/pages/`.
  The sitemap excludes `/app/*` (noindex). New pages are picked up by the e2e suite
  through the sitemap.
- **Voice:** short, plain, sentence case, no emoji, no em dashes in new text.

## Safety rules

- Demo data is synthetic: placeholder IDs such as EIN `00-0000001` and TIN
  `00-0000002`, invented names. Never add real taxpayer data or real-looking IDs.
- Secrets only in `.env`, Wrangler secrets, or Actions secrets. Never commit them.
- No autonomous filing, no training on client data, nothing ships unreviewed.
- Commits use the owner's git identity only. No AI or bot author, co-author,
  trailer, or "generated with" note anywhere.
- Do not touch: `package-lock.json` files by hand, `site/src/content/insights.json`
  (generated by `npm run pull-insights`), GitHub repo or Pages settings, `LICENSE`.

## Shipping a change

1. Branch from `main` (`feat/`, `fix/`, `docs/`, `chore/`); worktrees go in
   `.worktrees/<name>` or `.claude/worktrees/`.
2. One logical change per Conventional Commit, each passing `npm run verify:fast`.
3. Add an Unreleased entry to `CHANGELOG.md`.
4. Run `npm run verify`, push, and open a PR against `main`.

## Definition of done

- The requested behavior works and has a test.
- `npm run verify` passes; for UI work, the page was checked in the preview.
- `README.md`, `AGENTS.md`, and `CHANGELOG.md` match the code.
- Commands run, results, and anything unverified are reported.
