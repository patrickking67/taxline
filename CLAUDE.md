@AGENTS.md

# Claude Code notes

- `AGENTS.md` is canonical. Put durable changes there, not here.
- `.claude/rules/` holds the always-on design-system and agent-architecture rules.
- Start servers from `.claude/launch.json` with the preview tool (`taxline-site`,
  `taxline-site-dist`, `taxline-service`, `taxline-cms`).
- Never commit `.claude/settings.local.json`, `CLAUDE.local.md`, or machine paths.
