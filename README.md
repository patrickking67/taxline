# Taxline

**Agentic tax operations — from intake to reviewer-ready workpapers.**
A fleet of five AI agents (Intake · Extraction · Research · Workpaper · Compliance) works behind an orchestrator to remove manual tax operations for firms, businesses, and solo preparers — with a confidence score and a citation on every field, and **a human approving before anything ships.**

This is an npm-workspaces monorepo. The site is static-first and honest about GitHub Pages: **Pages serves static files only — no server runs there.** The backend is a separate Node service the site talks to through an adapter boundary.

```
taxline/
├── site/              # Astro 5 static site — marketing + the product app shell (the GUI)
├── service/           # Node + TS agent fleet (Anthropic SDK) — runnable with an API key
├── knowledge-base/    # markdown corpus (tax/ + practices/) + manifest.json + ingest/
├── workers/contact/   # Cloudflare Worker — the demo/contact form backend
├── .github/workflows/ # deploy.yml (→ GitHub Pages) + ci.yml
└── docs/              # design.md (spec) + design-contract.md (page-build rules)
```

## Quick start

```bash
npm install          # installs the site workspace
npm run dev          # Astro dev server → http://localhost:4321
npm run build        # static build → site/dist  (fingerprinted assets in _assets/)
npm run check        # astro check (typecheck)
```

The product app is at **`/app`** (intake queue → document → extraction review → approve). It is GUI-first; no command line is required to use the product.

### Agent fleet (backend)

```bash
cd service
cp .env.example .env          # add ANTHROPIC_API_KEY
npm install
npm run dev                   # JSON API → http://localhost:8787
```

Five agents behind an orchestrator, retrieving over `knowledge-base/`. Architecture is deliberate (agentic loop on `stop_reason`, hub-and-spoke, structured errors, a programmatic human-approval gate, no fabrication, confidence→human routing) — see `.claude/rules/agent-architecture.md`. The service can't run on static Pages; deploy it as a Node service or port tool-light calls to a Worker (see `service/README.md`).

## Backend adapter boundary

`site/src/lib/api/` is the seam between the static frontend and any backend:

| Adapter | When | Config |
| --- | --- | --- |
| `mock` (default) | static Pages, offline, demos | none |
| `cloudflare` | real form backend | `PUBLIC_API_ADAPTER=cloudflare`, `PUBLIC_CONTACT_ENDPOINT=<worker url>` |
| Azure Functions / Supabase / Formspree | swap-in | any endpoint that accepts `POST JSON → { ok, id }` |

The Cloudflare Worker lives in `workers/contact/` (honeypot + email validation, optional KV storage + Slack notify). Deploy with `wrangler deploy`; see `workers/contact/README.md`.

## Build, cache & deploy

Deployment is **GitHub Actions → GitHub Pages** on push to `main` (`.github/workflows/deploy.yml`):

- **npm dependency caching** via `actions/setup-node` (`cache: npm`).
- **Fingerprinted, cache-friendly assets** — Astro emits hashed files under `_assets/` (immutable, long-cache).
- **Configurable base path** — `BASE_PATH=/taxline` for a GitHub project page (`username.github.io/taxline`), or `/` for a custom domain. `SITE_URL` sets the canonical origin.

> **Heads-up:** GitHub Pages from a **private** repo requires a paid plan (Pro/Team/Enterprise). If the repo is private on a free plan, either make it public, or host the static build on **Cloudflare Pages** instead (point it at `site/` with build `npm run build` and output `site/dist`).

## Notes

- **Design system** is the source of truth: `site/src/styles/global.css` `@theme` tokens (graphite shell, warm-white text, one green accent, IBM Plex Sans/Mono, 8px max radius, warm "paper" document surface). Rules in `docs/design-contract.md`.
- **Knowledge base** tax figures are domain-knowledge seeds **flagged for source verification**; `knowledge-base/ingest/` is the live-refresh path.
- **No secrets in git** — `.env` is ignored; use `.env.example`, Wrangler secrets, and Actions secrets.
- No autonomous filing. No training on client data. Nothing ships unreviewed.
