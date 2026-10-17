# Always-on rule — Taxline design system (scope: site/)

Full contract: `docs/design-contract.md`. Essentials:

- **Tokens only.** Use the Tailwind v4 `@theme` utilities from `site/src/styles/global.css`: surfaces `bg-base/panel/raised/inset`; text `text-fg/fg-muted/fg-faint`; borders `border-border/-strong/-faint`; accent `text-accent bg-accent bg-accent-soft`; semantic `ok/warn/danger/info` (+`-bright`,`-soft`); paper `bg-paper text-paper-ink`. Never hardcode hex.
- **One accent.** Signal green `#3da57b`, used sparingly (live/active/confident/CTA). No purple, no glass/blur panels, no mascot, no oversized rounded cards. 8px max radius. Borders define surfaces, not shadows.
- **Type.** IBM Plex Sans (human) + IBM Plex Mono (machine: values, timestamps, eyebrows, code). Use `.ds-display/.ds-h1/.ds-h2/.ds-h3/.ds-lead/.ds-body/.ds-small/.ds-eyebrow`.
- **Reuse components**: `StatusPill`, `ConfidenceMeter`, `EvidenceChip`, `AgentCard`, `Button`, `Logo`, `AppShell`. Icons via `astro-icon` Lucide (`<Icon name="lucide:…"/>`), ~1.75 stroke, currentColor.
- **Voice.** Short, certain, technical. Sentence case. Address the reader as "you"; product is "Taxline" / "the fleet". No emoji. Quantify with confidence %/dates. Never: "replace accountants", "fully autonomous", "set it and forget it", "revolutionary/AI-powered/next-gen".
- **Accessibility.** Text tokens hold ≥4.5:1 contrast on every surface (WCAG AA); underline links inside prose; scrollable regions get `tabindex="0"`. `npm run test:e2e` enforces this with axe.
- **Confidence bands:** green ≥0.85, amber 0.6–0.85, red <0.6. Low confidence routes to human review.
