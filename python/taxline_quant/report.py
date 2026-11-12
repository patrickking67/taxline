"""Build the reproducible report: ``docs/quant/report.md`` and its SVG charts.

No notebook and no saved state: every figure in the report is recomputed from
the parameters at the top of this module each time it runs. ``build`` returns
the files as text; ``write`` puts them on disk; ``check`` compares the Markdown
with what is committed, which is how a test keeps the published numbers true.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Final

from . import DISCLAIMER
from .constants import FilingStatus
from .evals import CALIBRATED, OVERCONFIDENT, Evaluation, evaluate, generate_documents
from .evals.extractor import simulate_extraction
from .evals.metrics import REVIEW_THRESHOLD, Counts
from .evals.render import QUALITIES, render_documents
from .evals.rules import run_rules_extractor
from .model import ReturnInput, compute_return
from .montecarlo import PERCENTILES, Distribution, PlanOutcome, Projection, simulate
from .scenarios import grid, kinks, money_range, sensitivity, sweep

REPORT_NAME: Final = "report.md"
DEFAULT_DIR: Final = Path(__file__).resolve().parents[2] / "docs" / "quant"

# Everything the report shows follows from these.
FILER: Final = ReturnInput(status=FilingStatus.SINGLE, self_employment_profit=Decimal(120_000))
SWEEP_TOP: Final = Decimal(400_000)
SWEEP_STEP: Final = Decimal(2_500)
KINK_STEP: Final = Decimal(100)
MC_CV: Final = Decimal("0.35")
MC_DRAWS: Final = 10_000
MC_SEED: Final = 20_260_415
PRIOR_YEAR_TAX: Final = Decimal(24_000)
PRIOR_YEAR_AGI: Final = Decimal(110_000)
EVAL_SEED: Final = 7
EVAL_DOCUMENTS: Final = 600
TUNING_SEEDS: Final = (11, 23)
"""Seeds the extractor's confidence weights were set on. Never the report seed."""


def _usd(value: Decimal) -> str:
    return f"${value:,.2f}" if value >= 0 else f"-${-value:,.2f}"


def _usd0(value: Decimal) -> str:
    return f"${value:,.0f}" if value >= 0 else f"-${-value:,.0f}"


def _pct(value: Decimal | float, digits: int = 1) -> str:
    return f"{float(value) * 100:.{digits}f}%"


def _picture(stem: str, alt: str) -> str:
    return (
        "<picture>\n"
        f'  <source media="(prefers-color-scheme: dark)" srcset="{stem}-dark.svg">\n'
        f'  <img src="{stem}-light.svg" alt="{alt}" width="760">\n'
        "</picture>"
    )


def _dist_row(label: str, d: Distribution) -> str:
    cells = " | ".join(_usd0(d.percentile(p)) for p in PERCENTILES)
    return f"| {label} | {_usd0(d.mean)} | {cells} |"


def _plan_rows(plan: PlanOutcome) -> str:
    short = plan.shortfall_when_short
    median_short = _usd0(short.percentile(50)) if short else "n/a"
    p95_short = _usd0(short.percentile(95)) if short else "n/a"
    b = plan.balance_at_filing
    return (
        f"| `{plan.name}` | {_usd(plan.quarterly_payment)} | "
        f"{_pct(plan.shortfall_probability)} (SE {_pct(plan.shortfall_standard_error, 2)}) | "
        f"{median_short} | {p95_short} | {_usd0(b.percentile(5))} | {_usd0(b.percentile(50))} | "
        f"{_usd0(b.percentile(95))} |"
    )


def _mc_section(title: str, p: Projection) -> list[str]:
    head = "| Quantity | Mean | " + " | ".join(f"p{q}" for q in PERCENTILES) + " |"
    lines = [
        f"### {title}",
        "",
        head,
        "| --- | ---: | " + " | ".join("---:" for _ in PERCENTILES) + " |",
        _dist_row("Net profit", p.profit),
        _dist_row("Total tax", p.total_tax),
        _dist_row("Required annual payment", p.required_annual_payment),
        _dist_row("Required quarterly installment", p.required_quarterly_payment),
        "",
        "| Plan | Quarterly payment | Falls short of the requirement | Median shortfall "
        "| p95 shortfall | Balance at filing p5 | p50 | p95 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        *[_plan_rows(plan) for plan in p.plans],
        "",
        *[f"- `{plan.name}`: {plan.description}" for plan in p.plans],
        "",
    ]
    return lines


def _eval_rows(name: str, ev: Evaluation) -> str:
    c, g = ev.calibration, ev.gate_at(REVIEW_THRESHOLD)
    return (
        f"| {name} | {_pct(ev.overall.precision)} | {_pct(ev.overall.recall)} | "
        f"{ev.overall.f1:.3f} | {c.expected_calibration_error:.3f} | {c.brier_score:.3f} | "
        f"{_pct(c.mean_confidence)} | {_pct(c.accuracy)} | {_pct(g.review_rate)} | "
        f"{g.escaped_errors} ({_pct(g.escape_rate)}) | {_pct(g.catch_rate)} |"
    )


def _count_row(name: str, c: Counts) -> str:
    return (
        f"| {name} | {c.true_positive:,} | {c.false_positive:,} | {c.false_negative:,} | "
        f"{_pct(c.precision)} | {_pct(c.recall)} |"
    )


def _reliability_table(name: str, ev: Evaluation) -> list[str]:
    lines = [
        f"Reliability table, {name}:",
        "",
        "| Confidence bin | Fields | Mean confidence | Accuracy | Gap |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for b in ev.calibration.bins:
        if b.count:
            lines.append(
                f"| {b.lower:.1f} to {b.upper:.1f} | {b.count} | {_pct(b.mean_confidence)} | "
                f"{_pct(b.accuracy)} | {_pct(b.gap)} |"
            )
    return [*lines, ""]


def build() -> Mapping[str, str]:
    """Compute everything and return ``{file name: contents}``."""
    from . import charts  # noqa: PLC0415 - matplotlib is only needed to draw

    base = compute_return(FILER)
    points = sweep(FILER, "self_employment_profit", money_range(Decimal(0), SWEEP_TOP, SWEEP_STEP))
    fine = sweep(FILER, "self_employment_profit", money_range(Decimal(0), SWEEP_TOP, KINK_STEP))
    wages_filer = ReturnInput(
        status=FilingStatus.SINGLE,
        wages=Decimal(60_000),
        self_employment_profit=FILER.self_employment_profit,
        itemized=Decimal(22_000),
    )
    what_if = grid(
        FILER,
        "self_employment_profit",
        [Decimal(n) for n in (60_000, 90_000, 120_000, 150_000, 200_000, 300_000)],
        "itemized",
        [Decimal(n) for n in (0, 20_000, 30_000, 40_000)],
    )
    no_prior = simulate(FILER, cv=MC_CV, draws=MC_DRAWS, seed=MC_SEED)
    with_prior = simulate(
        FILER,
        cv=MC_CV,
        draws=MC_DRAWS,
        seed=MC_SEED,
        prior_year_tax=PRIOR_YEAR_TAX,
        prior_year_agi=PRIOR_YEAR_AGI,
    )
    documents = generate_documents(EVAL_SEED, EVAL_DOCUMENTS)
    rendered = render_documents(documents, EVAL_SEED)
    predictions = run_rules_extractor(rendered)

    def scored(*qualities: str) -> Evaluation:
        ids = {r.doc_id for r in rendered if r.quality in qualities}
        return evaluate(
            [d for d in documents if d.doc_id in ids],
            [p for p in predictions if p.doc_id in ids],
        )

    names = [q.name for q in QUALITIES]
    overall = scored(*names)
    by_quality = [(f"{name} scans", scored(name)) for name in names]
    charted = [
        ("all scans", overall),
        (f"{names[0]} scans", by_quality[0][1]),
        ("damaged scans", scored(*names[1:])),
    ]
    simulated = [
        (profile.name, evaluate(documents, simulate_extraction(documents, profile, EVAL_SEED)))
        for profile in (CALIBRATED, OVERCONFIDENT)
    ]

    files: dict[str, str] = {}
    for theme in charts.THEMES:
        files[f"rates-{theme.name}.svg"] = charts.rates_chart(points, theme)
        files[f"montecarlo-{theme.name}.svg"] = charts.montecarlo_chart(no_prior, theme)
        files[f"reliability-{theme.name}.svg"] = charts.reliability_chart(charted, theme)
        files[f"gate-{theme.name}.svg"] = charts.gate_chart(charted, theme)

    md: list[str] = [
        "# Taxline quantitative report, tax year 2026",
        "",
        f"> {DISCLAIMER}",
        "",
        "Generated by `python -m taxline_quant report`. Every number below is recomputed",
        "from the parameters in `python/taxline_quant/report.py`; a test fails if this file",
        "drifts from what the code produces. Constants and their sources are in",
        "[constants.md](constants.md).",
        "",
        "## 1. Baseline",
        "",
        f"A single filer with ${FILER.self_employment_profit:,.0f} of net self-employment "
        "profit, no wages, and the standard deduction.",
        "",
        "| Line | Form line | Amount |",
        "| --- | --- | ---: |",
        *[f"| {line.label} | {line.ref} | {_usd(line.value)} |" for line in base.lines()],
        "",
        f"Effective rate {_pct(base.effective_rate, 2)} of total income. Statutory bracket "
        f"{_pct(base.bracket_rate, 0)}.",
        "",
        "## 2. Marginal and effective rates",
        "",
        _picture(
            "rates",
            "Line chart of effective and marginal tax rate against self-employment profit "
            "from 0 to 400,000 dollars for a single filer",
        ),
        "",
        "The marginal rate is the change in total tax per extra dollar of profit, measured",
        "over the next $100 on the exact rate schedule. It includes self-employment tax, its",
        "deduction, and the QBI deduction, so it is not the bracket rate.",
        "",
        "| Net profit | Total tax | Effective rate | Marginal rate | Bracket | QBI deduction |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for p in points:
        if p.x % 50_000 == 0 and p.x > 0:
            md.append(
                f"| {_usd0(p.x)} | {_usd(p.total_tax)} | {_pct(p.effective_rate, 2)} | "
                f"{_pct(p.marginal_rate, 2)} | {_pct(p.bracket_rate, 0)} | "
                f"{_usd(p.qbi_deduction)} |"
            )
    md += [
        "",
        f"Where the marginal rate moves by at least three points (profit in ${KINK_STEP} steps):",
        "",
        "| At profit | From | To |",
        "| ---: | ---: | ---: |",
    ]
    md += [
        f"| {_usd0(k.x)} | {_pct(k.rate_before, 2)} | {_pct(k.rate_after, 2)} |"
        for k in kinks(fine)
        if abs(k.rate_after - k.rate_before) >= Decimal("0.03")
    ]
    md += [
        "",
        "The spike at $400 is the self-employment tax floor: no tax is due until net earnings",
        "reach $400, then it is due on all of them. From about $238,000 to $308,000 the QBI",
        "deduction phases out for a business with no W-2 wages (IRC sec. 199A(b)(3)(B)), which",
        "lifts the marginal rate above 60% before it settles at the bracket rate plus Medicare.",
        "",
        "## 3. What-if: profit by itemized deductions",
        "",
        "Total tax. The standard deduction is $16,100, so the first two columns match until",
        "itemized deductions exceed it.",
        "",
        "| Net profit | " + " | ".join(f"Itemized {_usd0(c)}" for c in what_if.cols) + " |",
        "| ---: | " + " | ".join("---:" for _ in what_if.cols) + " |",
    ]
    md += [
        f"| {_usd0(r)} | " + " | ".join(_usd(v) for v in what_if.total_tax[i]) + " |"
        for i, r in enumerate(what_if.rows)
    ]
    md += [
        "",
        "One-at-a-time sensitivity for a filer with $60,000 of wages, "
        f"${FILER.self_employment_profit:,.0f} of profit, and $22,000 of itemized deductions: "
        "change in total tax when each input moves 10%.",
        "",
        "| Input | Base | -10% | +10% | Elasticity |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    md += [
        f"| `{s.field}` | {_usd0(s.base_value)} | {_usd(s.low_delta)} | {_usd(s.high_delta)} | "
        f"{float(s.elasticity):.2f} |"
        for s in sensitivity(wages_filer)
    ]
    md += [
        "",
        "## 4. Estimated payments under income uncertainty",
        "",
        _picture(
            "montecarlo",
            "Histogram of simulated total federal tax across 10,000 draws with the 5th, "
            "50th and 95th percentiles marked",
        ),
        "",
        "Assumptions:",
        "",
        *[f"- {a}" for a in no_prior.assumptions[:5]],
        f"- {no_prior.assumptions[-1]}",
        "",
        *_mc_section("Without a prior-year safe harbor", no_prior),
        *_mc_section(
            f"With prior-year tax of {_usd0(PRIOR_YEAR_TAX)} (prior-year AGI "
            f"{_usd0(PRIOR_YEAR_AGI)})",
            with_prior,
        ),
        "Reading it: a plan built on the forecast falls short whenever profit beats the",
        "forecast. The prior-year safe harbor removes that exposure by definition, but the",
        "balance due at filing is as uncertain as before.",
        "",
        "## 5. Extraction evaluation",
        "",
        f"{EVAL_DOCUMENTS} synthetic documents (seed {EVAL_SEED}) with "
        f"{overall.truth_fields:,} known fields, rendered as the text a scan would yield and "
        "read by the rules extractor in `service/src/extract`, the code behind the service's "
        "`extract_fields` tool. The extractor is deterministic and offline, and it is not told "
        "which form it is reading. Its confidence comes from what it observes: how well the "
        "caption matches, whether the value fits its pattern, how damaged the rest of the "
        "document is, and whether the boxes agree with each other.",
        "",
        "The damage is a seeded noise model (`python/taxline_quant/evals/render.py`): "
        + ", ".join(
            f"{q.share_pct}% {q.name} scans ({q.char_error_per_mille / 10:g}% of characters "
            f"misread, {q.line_drop_per_mille / 10:g}% of lines missing)"
            for q in QUALITIES
        )
        + ". The confidence weights were set on seeds "
        + " and ".join(str(n) for n in TUNING_SEEDS)
        + f"; seed {EVAL_SEED} was held out. These numbers measure a rules extractor on "
        "synthetic text. They are not a measurement of a model, of OCR, or of real scans.",
        "",
        "| Scans | Precision | Recall | F1 | ECE | Brier | Mean confidence | Accuracy "
        f"| Sent to review at {REVIEW_THRESHOLD} | Errors past the gate | Errors caught |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        _eval_rows(f"all {overall.documents}", overall),
        *[_eval_rows(f"{ev.documents} {name}", ev) for name, ev in by_quality],
        "",
        "| Group | Correct | Wrong or invented | Missed | Precision | Recall |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        *[_count_row(name, c) for name, c in sorted(overall.by_doc_type.items())],
        *[_count_row(f"{name} fields", c) for name, c in sorted(overall.by_kind.items())],
        "",
        "Names are the weakest group: a name has no pattern to check and no other box to "
        "agree with, so a misread letter can only be suspected from the damage around it.",
        "",
        _picture(
            "reliability",
            "Reliability diagram: share of fields correct against mean stated confidence for "
            "the rules extractor on all, clean, and damaged synthetic scans",
        ),
        "",
        *_reliability_table("rules extractor, all scans", overall),
        _picture(
            "gate",
            "Line chart of the error rate among auto-accepted fields against the confidence "
            "threshold for the rules extractor on all, clean, and damaged synthetic scans, "
            "with the service gate at 0.85 marked",
        ),
        "",
        "| Threshold | " + " | ".join(f"{name}: review / error rate" for name, _ in charted) + " |",
        "| ---: | " + " | ".join("---:" for _ in charted) + " |",
    ]
    for i, row in enumerate(overall.gate):
        cells = " | ".join(
            f"{_pct(ev.gate[i].review_rate)} / {_pct(ev.gate[i].escape_rate, 2)}"
            for _, ev in charted
        )
        md.append(f"| {row.threshold} | {cells} |")
    md += [
        "",
        "Reading it: the gate does most of its work on damaged scans. What gets past it is "
        "mostly one digit or letter read as another on a field nothing else confirms. Those "
        "errors are why a person approves every result.",
        "",
        "### What miscalibration would cost (simulated)",
        "",
        "The rules extractor has one confidence model, so it cannot show what a badly "
        "calibrated one does. This comparison uses a simulator instead: two profiles that "
        "make the same mistakes on the same documents and differ only in the confidence they "
        "state. It is an illustration, not a measurement of any extractor.",
        "",
        "| Profile | Precision | Recall | F1 | ECE | Brier | Mean confidence | Accuracy "
        f"| Sent to review at {REVIEW_THRESHOLD} | Errors past the gate | Errors caught |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        *[_eval_rows(name, ev) for name, ev in simulated],
        "",
        "A fixed threshold only protects the reviewer if the confidence is honest. With",
        "inflated scores the same 0.85 gate sends fewer fields to a person and lets more",
        "wrong values through, which is why calibration is measured and not assumed.",
        "",
    ]
    files[REPORT_NAME] = "\n".join(md)
    return files


def write(directory: Path = DEFAULT_DIR) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, text in build().items():
        path = directory / name
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return sorted(written)


def check(directory: Path = DEFAULT_DIR) -> list[str]:
    """Names of generated Markdown files that are missing or out of date."""
    stale: list[str] = []
    for name, text in build().items():
        if not name.endswith(".md"):
            continue
        path = directory / name
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            stale.append(name)
    return stale
