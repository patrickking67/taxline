# Security policy

## Supported versions

Taxline is a portfolio project without tagged releases. Only the `main`
branch, and the site deployed from it at
https://patrickking67.github.io/taxline/, receive fixes.

## Reporting a vulnerability

Report privately through GitHub security advisories:
https://github.com/patrickking67/taxline/security/advisories/new

Please do not open a public issue for a vulnerability. Include what you found,
how to reproduce it, and the impact you expect. Use synthetic data only; never
send real taxpayer information.

## Scope

In scope:

- The static site and its client-side code (`site/`).
- The agent service (`service/`): the HTTP endpoints, the orchestrator, the
  confidence and human-approval gates, and tool permissions.
- The tax engine (`packages/tax-engine/`) where a wrong result could be
  presented as correct.
- The contact Worker (`workers/contact/`) and the CMS (`cms/`).
- Prompt injection that gets past a control enforced in code (for example,
  output shipping without approval, or a field skipping review).

Out of scope:

- Findings that need a leaked or self-supplied API key.
- Model output quality on its own, when the code-level gates still hold.
- Denial of service through volume, and issues in third-party services.

## What to expect

I aim to acknowledge a report within 7 days and to share a fix plan or a
decision within 30 days. I will credit you in the fix unless you ask me not
to.
