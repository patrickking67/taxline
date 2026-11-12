# Architecture

Taxline has two halves. The **agent system** takes tax documents from intake to a
reviewer-ready workpaper and stops at a human approval gate. The **quantitative
engine** is the deterministic math underneath it, written twice (TypeScript and
Python) so each implementation checks the other.

Not tax advice. All data is synthetic; the project is educational.

Deploy topology, trust boundaries, and failure modes are in
[system-design.md](system-design.md).

## 1. Components

```mermaid
flowchart LR
  subgraph Agents["Agent system"]
    Site["site/<br/>Astro: marketing, calculators, console"]
    Service["service/<br/>orchestrator + 5 agents"]
    Worker["workers/contact<br/>Cloudflare Worker"]
    CMS["cms/<br/>EmDash"]
    KB[("knowledge-base/")]
  end
  subgraph Quant["Quantitative engine"]
    TE["packages/tax-engine<br/>TypeScript, cited traces"]
    PY["python/taxline_quant<br/>Decimal model, scenarios, evals"]
    Report["docs/quant<br/>report + SVG charts"]
  end
  Site -->|imports| TE
  Service -->|compute_tax| TE
  Service -->|kb_search| KB
  Site -->|"adapter: mock or HTTP"| Service
  Site -->|contact form| Worker
  CMS -->|insights at build| Site
  PY <-->|"parity test: same cases, to the cent"| TE
  PY -->|"report command"| Report
  Report -->|"chart at build"| Site
```

What to notice: the site and the service both call the same TypeScript engine, so a
calculator and an agent cannot disagree about a number. The Python package never sits
in the request path. It reaches the product in two ways only: the parity test, and the
generated report whose chart the site inlines at build time.

## 2. The five-agent flow and the human gate

```mermaid
sequenceDiagram
  autonumber
  actor Reviewer
  participant Hub as Orchestrator
  participant Relay as Relay (intake)
  participant Lens as Lens (extraction)
  participant Atlas as Atlas (research)
  participant Ledger as Ledger (workpaper)
  participant Sentry as Sentry (compliance)
  participant Engine as Tax engine
  Reviewer->>Hub: task and document
  Hub->>Relay: classify the document
  Relay-->>Hub: document type
  Hub->>Lens: extract fields
  Lens-->>Hub: fields with confidence and citation
  Note over Hub: under 0.85, unscored, or out of range becomes a review item
  opt task is a research question
    Hub->>Atlas: search the knowledge base
    Atlas-->>Hub: cited findings
  end
  Hub->>Ledger: assemble the workpaper
  Ledger->>Engine: compute_tax
  Engine-->>Ledger: cited trace
  Ledger-->>Hub: workpaper draft
  Hub->>Sentry: deadlines and filing rules
  Sentry-->>Hub: compliance notes
  Note over Hub: an error, unknown agent, or the hop cap stops the chain and adds a review item
  Hub->>Hub: requireHumanApproval
  alt a person approved
    Hub-->>Reviewer: result ships
  else not approved
    Hub-->>Reviewer: withheld draft and review items
  end
```

What to notice: agents never call each other. The orchestrator
([`service/src/orchestrator.ts`](../service/src/orchestrator.ts)) runs one agent,
follows that agent's static `handoff`, and aggregates. The entry agent is picked from
the task text or passed explicitly, so a run may start at Lens or Atlas; the chain
always ends at Sentry. The client's `maxHops` is clamped to 1 through 5 by
`clampMaxHops`, and the approval gate runs last on every path.

## 3. Confidence and review routing

```mermaid
flowchart TD
  F["Field from extract_fields"] --> V{"Has a value?"}
  V -->|no| R1["Review: missing value"]
  V -->|yes| S{"Score is a number from 0 to 1?"}
  S -->|no| R2["Review: no score or invalid score"]
  S -->|yes| T{"Score at least the threshold?<br/>0.85, or stricter if asked"}
  T -->|no| R3["Review: below threshold"]
  T -->|yes| P["Passed"]
  E["Tool error, model error,<br/>truncation, refusal, hop cap"] --> R4["Review: early stop"]
  R1 --> Q["needsHumanReview"]
  R2 --> Q
  R3 --> Q
  R4 --> Q
  P --> G{"requireHumanApproval:<br/>approved by a person?"}
  Q --> G
  G -->|no| W["Output withheld as a draft"]
  G -->|yes| C{"No open review items<br/>and at least one citation?"}
  C -->|yes| M["Ships and is remembered"]
  C -->|no| O["Ships, not remembered"]
```

What to notice: every branch is code in
[`service/src/tools/confidence.ts`](../service/src/tools/confidence.ts) and the
orchestrator, covered by [`service/test/confidence.test.ts`](../service/test/confidence.test.ts)
and [`orchestrator.test.ts`](../service/test/orchestrator.test.ts). The model can ask
for a stricter threshold but never a looser one, and a score it restates only counts
if it matches a field `extract_fields` actually returned. A fixed threshold is only as
good as the scores fed to it, which is what the evaluation harness in section 5
measures.

## 4. The Python model's calculation flow

```mermaid
flowchart TD
  IN["ReturnInput<br/>Decimal amounts, floats rejected"] --> SE["Schedule SE<br/>92.35% x profit, 12.4% to the wage base, 2.9%"]
  IN --> TI["Total income<br/>wages + profit + other"]
  SE -->|"half of SE tax"| AGI["AGI"]
  TI --> AGI
  AGI --> DED["Less the larger of standard<br/>or itemized deduction"]
  DED --> QBI["Section 199A deduction<br/>threshold, phase-in, wage limit, SSTB, $400 minimum"]
  SE -->|"profit less half of SE tax"| QBI
  QBI --> TX["Taxable income"]
  TX --> IT{"Under $100,000?"}
  IT -->|yes| TT["Tax Table: row midpoint,<br/>whole dollars"]
  IT -->|no| RS["Rate schedule"]
  IN --> AM["Additional Medicare Tax<br/>0.9% over the threshold"]
  SE --> AM
  TT --> TOT["Total tax"]
  RS --> TOT
  SE --> TOT
  AM --> TOT
  TOT --> BAL["Refund or balance due"]
  TOT --> EST["Section 6654 safe harbor<br/>four installments"]
```

What to notice: this is [`python/taxline_quant/model.py`](../python/taxline_quant/model.py).
Every box rounds half up to the cent on `Decimal`, the same points where the
TypeScript engine rounds. Each constant the boxes read is listed with its source in
[quant/constants.md](quant/constants.md), generated from
[`constants.py`](../python/taxline_quant/constants.py). The scope is narrower than the
TypeScript engine on purpose: no capital gains, credits, or NIIT.

## 5. How the two engines and the evaluation harness check the system

```mermaid
flowchart LR
  subgraph Cases["Shared cases"]
    N["47 named edge cases<br/>parity/cases.json"]
    RND["5,000 seeded random cases"]
  end
  N --> PYM["taxline_quant<br/>Decimal"]
  RND --> PYM
  N --> TSM["tax-engine via Node<br/>parity/dump.ts"]
  RND --> TSM
  PYM --> CMP{"Every money line equal<br/>to the cent?"}
  TSM --> CMP
  CMP -->|yes| OK["CI passes"]
  CMP -->|no| FAIL["CI fails with the<br/>case and the field"]
  SYN["Synthetic documents<br/>with known truth"] --> REN["Rendered as text<br/>with seeded damage"]
  REN --> EX["Rules extractor<br/>service/src/extract via Node"]
  EX --> SC["Precision, recall,<br/>calibration error"]
  SC --> GATE["What the 0.85 gate<br/>catches and lets through"]
```

What to notice: the parity test is not a snapshot. Both engines run on every CI job
and the comparison has no tolerance for money. Its first run found that the
TypeScript engine rounded some exact half-cent ties down, because a product such as
43,230.95 x 0.9 reaches a double as 38,907.85499999999; the fix and its regression
test are in [`money.ts`](../packages/tax-engine/src/money.ts) and
[`engine.test.ts`](../packages/tax-engine/test/engine.test.ts). The evaluation harness
renders synthetic documents as damaged text, runs the service's rules extractor over
them through Node, and scores the result. It never calls a model API. Its published
numbers describe that extractor on a synthetic noise model, not a model and not real
scans; the confidence weights were set on seeds other than the one reported.
