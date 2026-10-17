# GitHub Copilot repository instructions

Before changing code:

- Read and follow the root `AGENTS.md`.
- Treat `AGENTS.md` as canonical for architecture, commands, standards, and validation.

Critical non-negotiables (repeated here because they must be direct):

- The end users are accountants. The product is GUI-first, never a CLI.
- A human approves before any output ships. Never describe the product as
  "fully autonomous" or as replacing accountants.
- Never commit secrets. Secrets live in `.env`, Wrangler secrets, or Actions secrets.
- Commits use only the repository owner's git identity. Never add an AI, bot,
  or assistant as author, co-author, committer, trailer, or reviewer.

Before completion:

- Run `npm run check`, `npm run lint`, `npm run typecheck`, and `npm test` (plus `npm run test:e2e` for site changes).
- Tax figures are computed only in `packages/tax-engine`; never hardcode tax math elsewhere.
