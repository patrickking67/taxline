# Taxline — page-build contract (read before creating any site page)

You are adding pages to an existing **Astro 5 + Tailwind v4** site for **Taxline** (agentic tax operations). The design system already exists — **reuse it, do not reinvent it**. Do **not** modify existing components, `global.css`, or `astro.config.mjs`. Do **not** add dependencies. Your page must build cleanly (`astro build`).

Repo root: `/Users/patrickking/Development/taxline`  ·  site: `site/`  ·  pages: `site/src/pages/`

## Page skeleton (copy this shape)
```astro
---
import Base from '../layouts/Base.astro';
import TopNav from '../components/TopNav.astro';
import Footer from '../components/Footer.astro';
import Button from '../components/Button.astro';
import { Icon } from 'astro-icon/components';
const base = import.meta.env.BASE_URL;
const u = (p = '') => (base + p).replace(/\/{2,}/g, '/');
---
<Base title="Page — Taxline" description="…">
  <TopNav />
  <main>
    <section class="border-b border-border">
      <div class="mx-auto max-w-[1200px] px-5 py-20 sm:px-6"> … </div>
    </section>
    …more sections…
  </main>
  <Footer />
</Base>
```
Use `u('contact')`, `u('docs')`, `u('app')`, `u('pricing')`, etc. for all internal links.

## Components (import from `../components/<Name>.astro`)
- `Button` — props `{ variant?: 'primary'|'ghost'|'text'; href?: string; size?: 'sm'|'md' }`, label via slot.
- `AgentCard` — `{ icon, name, title, body, tools?: string[], href? }`.
- `ConfidenceMeter` — `{ label: string; value: number|null; labelWidth?: string }` (green ≥0.85, amber 0.6–0.85, red <0.6).
- `StatusPill` — `{ status: 'running'|'waiting'|'blocked'|'idle'|'new'|'review'|'approved'|'archived'; label? }`.
- `EvidenceChip` — `{ icon? }`, content via slot (emphasis: `<b class="font-medium text-fg">x</b>`).
- `Logo` — `{ wordmark?, size? }`. `TopNav`/`Footer` — no props. Do NOT reuse `ConsoleHero` (home only).
- Icons: `<Icon name="lucide:NAME" class="size-4 …" />` (Lucide). Common: inbox, scan-line, search, file-stack, calendar-clock, shield-check, user-check, git-branch, check, lock, key, list-checks, map-pin, quote, book-open, arrow-right, table, grid-3x3, bot, line-chart, file-check, building-2, briefcase, user.

## Tokens — use ONLY these utilities (never invent colors)
Surfaces `bg-base bg-panel bg-raised bg-inset` · text `text-fg text-fg-muted text-fg-faint text-on-accent` · borders `border-border border-border-strong border-border-faint` (with `border`/`border-b`/`border-t`) · accent `text-accent bg-accent bg-accent-soft hover:bg-accent-hover` · semantic `text-ok/warn/danger/info`, `text-ok-bright/warn-bright/danger-bright/info-bright`, `bg-ok-soft/warn-soft/danger-soft/info-soft` · **paper** (light document surface) `bg-paper text-paper-ink text-paper-ink-muted border-paper-border`.
Type classes: `.ds-display .ds-h1 .ds-h2 .ds-h3 .ds-lead .ds-body .ds-small .ds-eyebrow` (eyebrow = mono uppercase tracked green kicker). `font-mono` for machine/data/values/timestamps/code. Radius `rounded-sm/md/lg` (8px max). Shadow `shadow-1/shadow-2`.

## Layout conventions (match the home page)
- Section: `<section class="border-b border-border"><div class="mx-auto max-w-[1200px] px-5 py-20 sm:px-6">…</div></section>`.
- Section intro pattern: `<p class="ds-eyebrow">Kicker</p>` → `<h2 class="ds-h2 mt-3 max-w-2xl">…</h2>` → `<p class="ds-lead mt-3 max-w-2xl">…</p>`.
- Cards: `rounded-lg border border-border bg-panel p-5 shadow-1`. Grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.

## Voice (strict)
Short, certain, technical. Sentence case headings. Address the reader as **you**; the product is **Taxline** or **the fleet** (avoid "we believe"). Verb-first imperatives. Quantify with confidence %/dates where natural. **Never** say "replace accountants", "fully autonomous", "set it and forget it", "revolutionary/AI-powered/next-gen". **No emoji.** Approved lines: "Remove manual tax operations." "Reduce review drag." "Keep the human approval." "Reviewer-ready output."

Reference facts:
- Five agents: **Intake, Extraction, Research, Workpaper, Compliance** (behind an orchestrator).
- Product items: AI Tax Co-Pilot · Agent Workforce · Tax Research · Tax Prep Support · Client Intelligence · Workpaper Builder · Compliance Calendar · Tax Matrix.
- Audiences: Tax & accounting firms · Businesses · Solo operators.
- Always true: a human approves before output ships; every field carries a confidence score + citation.

## Deliverable
Create your single assigned file, well-structured and genuinely on-brand (3–6 sections). Do NOT run builds or git. Return only: the file path + a one-line list of sections.
