# taxline-quant

The quantitative half of Taxline: a typed Python model of the tax year 2026
federal income tax, the analysis built on it, and an offline evaluation harness
for the agents' extraction step.

> Educational software on synthetic data. Not tax, legal, or accounting advice.
> Do not file or pay based on its output.

## What is here

| Module | What it does |
| --- | --- |
| `constants.py` | Every TY2026 figure with its source (Rev. Proc. 2025-32, the Code, SSA). Generates [`docs/quant/constants.md`](../docs/quant/constants.md). |
| `model.py` | Form 1040 estimate on `Decimal`: rate schedule and Tax Table, standard or itemized deduction, Schedule SE, the section 199A deduction for one business, Additional Medicare Tax. |
| `estimated.py` | The section 6654(d) safe harbor and four installments. |
| `scenarios.py` | Sweeps over any input, marginal and effective rates, income-by-deduction grids, one-at-a-time sensitivity. |
| `montecarlo.py` | Seeded projection of required estimated payments when profit is uncertain. |
| `evals/` | Synthetic documents with known truth, a simulated extractor, and field-level precision, recall, and calibration scoring. |
| `parity.py` | Runs the same cases through the TypeScript engine and lists every difference. |
| `report.py`, `charts.py` | Rebuild [`docs/quant/report.md`](../docs/quant/report.md) and its SVG charts. |

Money is `decimal.Decimal` everywhere. A float passed as an amount raises
`TypeError`. Each published line is rounded half up to the cent.

## Run it

Needs Python 3.12 or newer and [uv](https://docs.astral.sh/uv/).

```bash
cd python
uv sync
uv run python -m taxline_quant tax --status single --se-profit 100000
uv run python -m taxline_quant sweep --status single --vary self-employment-profit --start 0 --stop 300000 --step 50000
uv run python -m taxline_quant montecarlo --status single --se-profit 120000 --cv 0.35 --seed 7
uv run python -m taxline_quant eval --profile overconfident
uv run python -m taxline_quant constants
uv run python -m taxline_quant report          # rewrites docs/quant/
uv run python -m taxline_quant parity          # needs Node and `npm ci` at the repo root
```

Add `--json` to `tax`, `sweep`, `montecarlo`, or `eval` for machine-readable
output; amounts come back as strings so nothing is read back as a float.

To score a recorded extraction run instead of the simulator:

```bash
uv run python -m taxline_quant eval \
  --truth tests/data/extraction_truth.json \
  --recorded tests/data/extraction_recorded.json
```

Both files use the shape of the service's `extract_fields` result.

## Checks

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
```

`npm run verify:python` at the repo root runs all of them with the parity test
required. Without Node the parity tests skip; CI sets `TAXLINE_PARITY_REQUIRED=1`
so they cannot skip there.

How the tests are built:

- Expected values are worked by hand from the IRS tables and stated in comments.
- Hypothesis properties cover the invariants: the schedule equals the published
  base-plus-excess form, tax never falls as wages rise, installments sum to the
  amount due, calibration bins account for every prediction.
- The parity test runs 47 named edge cases and 5,000 seeded random cases through
  both this package and `packages/tax-engine` and fails on a one-cent difference.
- `docs/quant/report.md` and `docs/quant/constants.md` are compared with what the
  code produces, so the published numbers cannot go stale.

## Scope

Modeled: four filing statuses, wages, Schedule C profit or loss, other ordinary
income, adjustments, the standard or an itemized deduction, self-employment tax,
QBI for one business (threshold, phase-in, W-2 wage and UBIA limit, SSTB, the
$400 minimum), Additional Medicare Tax, and the estimated tax safe harbor.

Not modeled: capital gains and qualified dividends, credits, net investment
income tax, AMT, state and local tax, multiple businesses, loss carryovers, and
the annualized income installment method. The TypeScript engine covers more of
the return; this package matches it on the inputs both accept.

The Tax Table row layout is the one published for tax year 2025; the 2026
instructions were not out when this was written.
