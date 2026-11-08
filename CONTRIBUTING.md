# Contributing

Thanks for taking a look. `AGENTS.md` is the full guide to the layout and
conventions; this file covers setup and the pull request flow.

## Setup

Node `^22.22.3`, `^24.16.0`, or `>=26.3.0` (`.nvmrc` pins 22).

```bash
npm ci                              # site, tax engine, lint toolchain
npm --prefix service ci             # agent fleet
npm --prefix workers/contact ci     # contact Worker
npm --prefix cms ci                 # EmDash CMS (only for npm run verify)
(cd site && npx playwright install chromium)   # browsers for the e2e suite
```

Run the site with `npm run dev` (http://localhost:4321/) and the fleet with
`npm run dev:service` (http://localhost:8787/health). Neither needs an API key.

## Branches and commits

- Branch from `main` as `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, or
  `chore/<topic>`.
- Write [Conventional Commits](https://www.conventionalcommits.org/):
  `fix(service): ...`, `feat(site): ...`, `docs: ...`.
- One logical change per commit. Each commit should pass the checks.
- Use your own git identity. No AI or bot authors, co-authors, or trailers.

## Checks

```bash
npm run verify:fast    # lint, every typecheck, engine + service + Worker tests
npm run verify         # the full CI set: adds the site build, Playwright + axe, and the CMS build
```

## Pull request checklist

- [ ] `npm run verify` passes locally.
- [ ] New behavior has a test. Tax figures come from `packages/tax-engine`,
      with expectations worked by hand from the cited IRS source.
- [ ] UI changes keep axe clean and hold up at 375px with no horizontal
      scroll; new pages are covered by the e2e suite.
- [ ] Data is synthetic: placeholder IDs such as EIN `00-0000001`, invented
      names, no real taxpayer data.
- [ ] No secrets. Keys live in `.env`, Wrangler secrets, or Actions secrets.
- [ ] Docs (`README.md`, `AGENTS.md`, `CHANGELOG.md`) match the change.
