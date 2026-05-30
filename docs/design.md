# Taxline — Build Design

_Last updated: 2026-05-30_

**Shape:** npm-workspaces monorepo. The `site/` is the primary deliverable; the `service/` is the real agent fleet; `workers/` is the form backend. Static-first, honest about GitHub Pages (no pretend server code on Pages).

```
taxline/
├── site/              # Astro 5 — marketing + product shell (8 pages)  ← heart
├── service/           # Claude Agent SDK workforce — 5 agents, deployable
├── knowledge-base/    # markdown KB + manifest + refresh ingest (the "living" KB)
├── workers/contact/   # Cloudflare Worker — primary form backend
├── .github/workflows/ # deploy (Pages, npm cache, fingerprinted) + ci
└── docs/              # design spec + research notes
```

## 1 — Site (Astro, static)
Tailwind v4 CSS-first `@theme` tokens (graphite/black shell, warm-white text, thin borders, 8px max radius — no glass, no purple, no mascot). Zero JS by default; **only the console hero hydrates** as an island. Pages: Home, Product, Agents, Solutions, Security, Pricing, Docs (MDX), Contact/Demo.

## 2 — The console hero (first viewport, not a vague hero)
A live dark operations console: intake queue · agent activity · uploaded docs · extraction confidence meters · reviewer issues · compliance deadlines · handoff status · citation-backed evidence chips. Driven by typed seed data so it animates believably.

## 3 — Mega-menu
Compact, audience tabs (Firms · Businesses · Solo), product items: AI Tax Co-Pilot, Agent Workforce, Tax Research, Tax Prep Support, Client Intelligence, Workpaper Builder, Compliance Calendar, Tax Matrix.

## 4 — Agent fleet (`service/`, Claude Agent SDK — runnable with an API key)
5 to start, each a real agent with tools + KB retrieval, behind an orchestrator:

| Agent | Job | Key tools |
| --- | --- | --- |
| **Intake** | triage docs/requests → intake queue | classify, route |
| **Extraction** | pull fields w/ confidence + citations | doc-extract, confidence |
| **Research** | tax research, citation-backed | kb-search (retrieval) |
| **Workpaper** | reviewer-ready workpapers | assemble, cite |
| **Compliance** | deadlines + client follow-up | calendar, notify |

## 5 — Living knowledge base (`knowledge-base/`)
Markdown corpus + `manifest.json` (source, last-updated, cadence) + an `ingest/` refresh script the Research agent retrieves over. Seeded from a real tax-AI / IRS-automation research pass (also saved as research notes).

## 6 — Backend boundaries (honest)
`site/src/lib/api/` adapter layer: `mock` (default, works on Pages) → `cloudflare` (real). `workers/contact/` is the fully-wired CF Worker; README documents KV/D1/email + swapping adapters to Azure/Supabase/Formspree.

## 7 — Ship
GitHub Actions: npm-cached build → Pages, fingerprinted assets, configurable base path. Plus README (dev/build/deploy/cache/adapter notes) and a project `CLAUDE.md`.

## Copy tone
Short, certain, technical. "Remove manual tax operations," "reduce review drag," "preserve human approval," "reviewer-ready output." Never "replace accountants."

## Build order
research sweep (seeds KB + copy) → scaffold + theme tokens → nav/mega-menu + design primitives → console hero → remaining pages → service + KB → Worker + CI/CD → README + CLAUDE.md → verify build runs clean.

## Company
- Aden Mina — Chief Executive Officer (50%)
- Patrick King — Chief Technology Officer (50%)
