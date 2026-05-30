# AGENTS.md

Codex-facing guide for this repo. Shares behavior with `CLAUDE.md` (the fuller
instruction file) — read that for the full design system, agent-architecture, and
security rules. This file is the short operational version.

## What this is

**Taxline** — agentic tax operations. A fleet of five AI agents (Intake, Extraction,
Research, Workpaper, Compliance) works behind an orchestrator to remove manual tax
operations **while preserving human approval**. End users are accountants; the product
is **GUI-first, never a CLI**. Never market it as "replace accountants" or "fully
autonomous".

## Layout

```
site/            Astro 5 static site — marketing + the product app shell (the GUI)
service/         Node + TS agent fleet (Anthropic SDK) — the backend
knowledge-base/  Markdown corpus + manifest.json + ingest/ the agents retrieve over
workers/contact/ Cloudflare Worker — demo/contact form backend
docs/            design.md (spec), design-contract.md, system-design.md
.claude/rules/   always-on conventions (design-system.md, agent-architecture.md)
```

## Commands

```bash
npm install            # root (installs the site workspace + lint toolchain)
npm run dev            # Astro dev server → http://localhost:4321
npm run dev:service    # agent fleet  → http://localhost:8787
npm run build          # static build → site/dist
npm run check          # astro typecheck
npm run typecheck      # site + service + worker typecheck
npm run lint           # eslint (flat config)
npm run format         # prettier --write
npm run refresh-kb     # re-review the knowledge base + restamp the manifest
```

`service/` and `workers/contact/` have their own deps — `npm install` inside each.

## Conventions

- **Design tokens are the source of truth** (`site/src/styles/global.css` `@theme`).
  Use the Tailwind utilities; never hardcode hex. One green accent (`#3da57b`),
  ≤8px radius, borders not shadows, IBM Plex Sans/Mono. Reuse the primitives
  (`StatusPill`, `ConfidenceMeter`, `EvidenceChip`, `AgentCard`, `Button`, `Logo`).
  Full rules: `docs/design-contract.md` and `.claude/rules/design-system.md`.
- **Backend boundary is the adapter layer** (`site/src/lib/api/`): `mock` (default,
  static) vs. live (`PUBLIC_API_ADAPTER`/`PUBLIC_SERVICE_ENDPOINT`). The site never
  assumes a server exists.
- **Agent fleet principles** (`.claude/rules/agent-architecture.md`): agentic loop on
  `stop_reason`; hub-and-spoke; isolated agent context; structured errors; a
  programmatic `requireHumanApproval` gate; nullable tool fields (no fabrication);
  confidence `<0.85` → human review.
- Voice: short, certain, technical. Sentence case. No emoji. Quantify with
  confidence %/dates.

## Security & attribution

- No autonomous filing. No training on client data. Nothing ships unreviewed.
- Secrets only in `.env` / Wrangler secrets / Actions secrets — never committed.
- Commits use the owner's git identity only. **Never** add an AI/bot as author,
  co-author, committer, trailer, reviewer, or in any file. No "generated with" notes.
