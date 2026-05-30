> Domain-knowledge seed — verify figures/dates against the cited IRS source before relying on it. The ingest/ refresh is the live-source path.

# Entities and their returns

Which entity files which primary federal return. Thresholds, elections, and special
cases must be verified against current IRS guidance.

- **Sole proprietor** → income/expense reported on **Schedule C**, filed with the owner's individual return (**1040**).
- **Partnership** → files **Form 1065** (information return); partners receive **K-1 (Form 1065)** and report their shares on their own returns.
- **S-corporation** → files **Form 1120-S**; shareholders receive **K-1 (Form 1120-S)** and report their shares on their own returns.
- **C-corporation** → files **Form 1120** and pays tax at the entity level.
- **Individual** → files **Form 1040**.

Notes:
- A single-member LLC is, by default, disregarded → Schedule C (treated like a sole prop) unless it elects corporate treatment.
- Entity elections (e.g. S-corp election) change the return; confirm the election status before assuming a form.
- Exempt organizations file in the **990** series (see filing-deadlines.md for timing).

Verify entity classification, elections, and thresholds against current IRS guidance.
