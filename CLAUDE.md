@AGENTS.md

# Claude Code-specific instructions

- Treat root and applicable nested `AGENTS.md` files as canonical.
- Use `.claude/rules/` for Claude-specific scoped behavior (design system, agent architecture).
- Use `.claude/launch.json` with `preview_start` to run dev servers; never ask the user to run them.
- Do not create or rely on local or user-level configuration.
- Never place secrets in repository files.
- After durable changes, update `AGENTS.md` rather than this file.
