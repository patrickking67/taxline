# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The project has
not cut a tagged release yet, so history below is grouped by date.

## [Unreleased]

### Added

- A light theme for the site. Every color token is `light-dark()`, the page
  follows `prefers-color-scheme`, and a toggle in the nav and the console
  overrides and remembers the choice. The rate chart swaps between its light
  and dark renderings.
- The e2e suite runs axe on every page in both themes and on the demo console,
  and covers the toggle.
- The e2e suite runs axe on every page in both themes and on the demo console,
  and covers the toggle and the diagram.

- A deterministic, offline rules extractor behind `extract_fields`
  (`service/src/extract`): caption anchoring, format validation with counted
  repairs, and cross-field arithmetic for W-2, 1099-NEC, and 1099-INT text.
  Each field's confidence is derived from those signals and its citation points
  at the source line.
- A model cross-check for extraction when an API key is set. The model reads
  the same text; any disagreement caps the field under the review threshold and
  adds a review item with both readings. It cannot raise a confidence.
- Rendered synthetic scans with a seeded damage model
  (`python/taxline_quant/evals/render.py`) and a runner that scores the
  service's extractor through Node (`evals/rules.py`).

- `python/taxline_quant`, a typed Python package for tax year 2026: a federal
  income tax model on `Decimal` (rate schedule and Tax Table, standard or
  itemized deduction, Schedule SE, the section 199A deduction, Additional
  Medicare Tax, the section 6654 safe harbor) with every constant cited and
  listed in `docs/quant/constants.md`.
- A parity test that runs 47 named cases and 5,000 seeded random cases through
  both the Python model and the TypeScript engine and fails on a one-cent
  difference (`python/tests/test_parity.py`, `packages/tax-engine/parity/`).
- Scenario sweeps, income-by-deduction grids, and one-at-a-time sensitivity;
  a seeded Monte Carlo projection of required estimated payments under profit
  uncertainty, with its assumptions returned alongside the result.
- An offline evaluation harness for field extraction: synthetic documents with
  known truth, a simulated extractor, precision, recall, expected calibration
  error, a reliability table, and what the 0.85 review gate lets through. It
  can also score a recorded run in the service's `extract_fields` shape.
- `python -m taxline_quant` (`tax`, `sweep`, `montecarlo`, `eval`, `constants`,
  `report`, `parity`) and a generated report with SVG charts in `docs/quant/`.
- A CI job for the Python package on 3.12 and 3.13 (ruff, mypy --strict,
  pytest, parity required), `npm run verify:python`, and `npm run report`.
- `docs/architecture.md` with component, agent-flow, review-routing,
  calculation, and cross-check diagrams; README screenshots in `docs/assets/`
  captured by `scripts/capture-screenshots.mjs`.
- A quantitative engine section on the home page with the generated rate
  chart, and source, architecture, and author links in the footer.

### Fixed

- Citations in the Python constants: the Social Security wage base now cites the
  SSA notice (90 FR 49047, 2025-11-03) where it cited an IRS topic page, the
  section 199A phase-in range and minimum cite Pub. L. 119-21 sec. 70105 as
  amendments, forms carry their revision year, and the Tax Table rows say they
  follow the 2025 instructions because the 2026 ones are not published. No value
  changed. The TypeScript labels for section 199A and the wage base match.

- The tax engine rounded some exact half-cent ties down. A product such as
  43,230.95 x 0.9 reaches `round2` as 38,907.85499999999, so the result was a
  cent low. `round2` now snaps to 15 significant digits before rounding. Found
  by the parity test; it changes a result only where the old one was a cent
  off the engine's own half-up rule.
- Schedule SE reported the remaining wage base with float noise
  (34,770.76999999999) when W-2 wages had cents.
- A client `maxHops` could end the agent chain early with no review item, and
  `maxHops: 0` ran no agent at all. The orchestrator now clamps it to 1 through
  5 and adds a review item naming the agent that did not run, so an early stop
  always reaches the reviewer and is never written to memory.
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

- Section 5 of `docs/quant/report.md` now scores the service's rules extractor
  on held-out synthetic scans. The simulated extractor remains as a labelled
  illustration of what miscalibration costs.
- `extract_fields` returns a `business` failure for document types it has no
  parser for, where it used to return seeded values.
- The seeded W-2 and 1099-NEC carry a text layer and their queue fields are read
  from it; the site's demo data mirrors the result.

- The README leads with a screenshot, the engineering decisions, and Mermaid
  diagrams of both halves of the project.
- The Open Graph image is 1200 by 630 and taken from the real home page.
- `E2E_PORT` moves the Playwright server when port 4173 is in use.
- The repo is formatted with Prettier, and `npm run format:check` runs in
  `npm run verify`, `npm run verify:fast`, and the CI lint job. Generated files
  are listed in `.prettierignore`.
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
