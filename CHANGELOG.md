# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project has
not cut a tagged release yet, so history below is grouped by date.

## [Unreleased]

### Fixed

- `compute_deadline` checks fixed-date holidays on their observed date, so the
  2022 and 2023 Form 1040 deadlines come out as April 18 (Emancipation Day was
  observed on the Friday before and the Monday after). Impossible dates such as
  `2025-02-30` are validation errors instead of rolling over.
- The service returns 400 for a JSON body that is not an object (it used to
  throw and return a 500), and a real 413 for an oversized body instead of
  resetting the socket. 500s no longer echo internal error text.
- The contact Worker rejects non-object JSON with 400, stops two leads in the
  same millisecond from sharing a KV key, escapes text sent to Slack, and caps
  field lengths and body size.
- The preferential-income formula on the income tax calculator no longer
  clips at desktop width.

### Changed

- The site keeps one entrance animation (the hero) and no longer hides
  sections until they scroll into view. Linked cards answer hover with the
  border only.
- `.claude/launch.json` configs are named `taxline-site`, `taxline-site-dist`,
  `taxline-service`, and `taxline-cms`.
- Issue templates are YAML forms; Dependabot covers `cms/` and groups GitHub
  Actions updates.
- `AGENTS.md` is shorter and lists the exact commands CI runs.

### Added

- `npm run verify` runs the same checks as CI; `npm run verify:fast` runs lint,
  typecheck, and unit tests.
- Contact Worker tests (`node:test`, in-memory KV), and service tests for the
  HTTP boundary and filing deadlines.
- `llms.txt` links the source, README, AGENTS.md, and changelog, and a copy
  sits at the repo root (`npm run llms` refreshes it).
- `CONTRIBUTING.md`, `SECURITY.md`, and this changelog.

## 2026-11-07

- Service: model failures become structured errors and review items instead
  of throws; closed ways for the model to restate a confidence score or
  invent a passed field.
- CI runs on every push, adds service tests, and uses read-only permissions.
- README: agent handoff diagram, offline demo, environment variables, and
  limitations.

## 2026-10-17

- Tax engine for tax year 2026 with cited figures and hand-worked tests.
- AI scenario intake validated in code, six free calculators, EmDash CMS for
  Insights, and the SEO foundation (canonical tags, JSON-LD, sitemap,
  `llms.txt`).
- Moved to Astro 7, cleared security alerts, and added Playwright and axe
  tests against the production build under `/taxline`.

## 2026-08-25

- Fixed every internal link on the deployed site.
- Added the MIT license, consolidated agent instructions into `AGENTS.md`, and
  fixed the site typecheck.

## 2026-05-30

- First public version: Astro site, product console, the five-agent fleet
  with the human-approval gate, vector memory, knowledge base with
  content-hash ingest, Cloudflare contact Worker, and the GitHub Pages deploy.
