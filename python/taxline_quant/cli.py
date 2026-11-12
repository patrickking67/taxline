"""Command line: ``python -m taxline_quant <command>``.

Amounts are parsed as ``Decimal`` straight from the argument text, so nothing
passes through a float on the way in.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from . import DISCLAIMER, __version__
from .constants import FilingStatus, constant_table, constants_markdown
from .estimated import estimated_tax
from .model import ReturnInput, compute_return
from .montecarlo import PERCENTILES, simulate
from .scenarios import SWEEPABLE, money_range, sweep


def _money(text: str) -> Decimal:
    try:
        value = Decimal(text.replace(",", "").replace("$", ""))
    except InvalidOperation:
        raise argparse.ArgumentTypeError(f"not an amount: {text!r}") from None
    if not value.is_finite():
        raise argparse.ArgumentTypeError(f"not a finite amount: {text!r}")
    return value


def _add_return_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--status", type=FilingStatus, choices=list(FilingStatus), required=True)
    parser.add_argument("--wages", type=_money, default=Decimal(0))
    parser.add_argument("--se-profit", type=_money, default=Decimal(0))
    parser.add_argument("--other-income", type=_money, default=Decimal(0))
    parser.add_argument("--adjustments", type=_money, default=Decimal(0))
    parser.add_argument("--itemized", type=_money, default=Decimal(0))
    parser.add_argument("--withholding", type=_money, default=Decimal(0))
    parser.add_argument("--estimated-payments", type=_money, default=Decimal(0))
    parser.add_argument("--qbi-w2-wages", type=_money, default=Decimal(0))
    parser.add_argument("--qbi-ubia", type=_money, default=Decimal(0))
    parser.add_argument("--sstb", action="store_true")
    parser.add_argument(
        "--rate-schedule",
        action="store_true",
        help="use the rate schedule below $100,000 instead of the Tax Table",
    )


def _return_input(args: argparse.Namespace) -> ReturnInput:
    return ReturnInput(
        status=args.status,
        wages=args.wages,
        self_employment_profit=args.se_profit,
        other_income=args.other_income,
        adjustments=args.adjustments,
        itemized=args.itemized,
        federal_withholding=args.withholding,
        estimated_payments=args.estimated_payments,
        qbi_w2_wages=args.qbi_w2_wages,
        qbi_ubia=args.qbi_ubia,
        sstb=args.sstb,
        use_tax_table=not args.rate_schedule,
    )


def _json_default(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps({**payload, "disclaimer": DISCLAIMER}, indent=2, default=_json_default))


def _pct(value: Decimal) -> str:
    return f"{value * 100:.2f}%"


def _cmd_tax(args: argparse.Namespace) -> int:
    inputs = _return_input(args)
    r = compute_return(inputs)
    est = estimated_tax(
        inputs.status,
        r.total_tax,
        inputs.federal_withholding,
        prior_year_tax=args.prior_year_tax,
        prior_year_agi=args.prior_year_agi,
    )
    if args.json:
        _emit(
            {
                "tax_year": 2026,
                "lines": {line.key: line.value for line in r.lines()},
                "effective_rate": r.effective_rate,
                "bracket_rate": r.bracket_rate,
                "marginal_rate": r.marginal_rate,
                "qbi_regime": r.qbi.regime.value,
                "estimated": {
                    "required": est.required,
                    "reason": est.reason,
                    "safe_harbor": est.safe_harbor,
                    "installments": {i.due: i.amount for i in est.installments},
                },
            }
        )
        return 0
    print("Form 1040 estimate, tax year 2026")
    for line in r.lines():
        print(f"  {line.label:<38}{line.ref:>10}  {line.value:>14,.2f}")
    print(f"  Effective rate {_pct(r.effective_rate)}, bracket {_pct(r.bracket_rate)}, ", end="")
    print(f"marginal on the next $100 of ordinary income {_pct(r.marginal_rate)}")
    print(f"  Estimated tax: {est.reason}")
    if est.required:
        for i in est.installments:
            print(f"    {i.due}  {i.amount:>12,.2f}")
    print(DISCLAIMER)
    return 0


def _cmd_sweep(args: argparse.Namespace) -> int:
    field = args.vary.replace("-", "_")
    points = sweep(_return_input(args), field, money_range(args.start, args.stop, args.step))
    if args.json:
        _emit({"vary": field, "points": [{k: getattr(p, k) for k in p.__slots__} for p in points]})
        return 0
    print(f"{field:>24} {'total tax':>14} {'effective':>10} {'marginal':>10} {'bracket':>8}")
    for p in points:
        print(
            f"{p.x:>24,.2f} {p.total_tax:>14,.2f} {_pct(p.effective_rate):>10} "
            f"{_pct(p.marginal_rate):>10} {_pct(p.bracket_rate):>8}"
        )
    print(DISCLAIMER)
    return 0


def _cmd_montecarlo(args: argparse.Namespace) -> int:
    p = simulate(
        _return_input(args),
        cv=args.cv,
        draws=args.draws,
        seed=args.seed,
        prior_year_tax=args.prior_year_tax,
        prior_year_agi=args.prior_year_agi,
    )
    quantities = {
        "net_profit": p.profit,
        "total_tax": p.total_tax,
        "required_annual_payment": p.required_annual_payment,
        "required_quarterly_payment": p.required_quarterly_payment,
    }
    if args.json:
        _emit(
            {
                "seed": p.seed,
                "draws": p.draws,
                "distributions": {
                    name: {"mean": d.mean, **{f"p{q}": v for q, v in d.percentiles}}
                    for name, d in quantities.items()
                },
                "plans": [
                    {
                        "name": plan.name,
                        "quarterly_payment": plan.quarterly_payment,
                        "shortfall_probability": plan.shortfall_probability,
                        "shortfall_standard_error": plan.shortfall_standard_error,
                    }
                    for plan in p.plans
                ],
                "assumptions": list(p.assumptions),
            }
        )
        return 0
    header = "".join(f"{f'p{q}':>12}" for q in PERCENTILES)
    print(f"{'':<28}{'mean':>12}{header}")
    for name, d in quantities.items():
        cells = "".join(f"{v:>12,.0f}" for _, v in d.percentiles)
        print(f"{name:<28}{d.mean:>12,.0f}{cells}")
    for plan in p.plans:
        print(
            f"plan {plan.name}: {plan.quarterly_payment:,.2f} per quarter, short of the "
            f"requirement in {_pct(plan.shortfall_probability)} of draws "
            f"(standard error {_pct(plan.shortfall_standard_error)})"
        )
    print("Assumptions:")
    for line in p.assumptions:
        print(f"  - {line}")
    print(DISCLAIMER)
    return 0


def _cmd_eval(args: argparse.Namespace) -> int:
    from .evals import PROFILES, evaluate, generate_documents  # noqa: PLC0415
    from .evals.extractor import simulate_extraction  # noqa: PLC0415
    from .evals.metrics import REVIEW_THRESHOLD  # noqa: PLC0415
    from .evals.recorded import load_predictions, load_truth  # noqa: PLC0415

    if (args.truth is None) != (args.recorded is None):
        print("--truth and --recorded go together", file=sys.stderr)
        return 2
    if args.truth is not None:
        documents = load_truth(args.truth)
        predictions = load_predictions(args.recorded)
        source = f"recorded run {args.recorded}"
    else:
        documents = generate_documents(args.seed, args.documents)
        predictions = simulate_extraction(documents, PROFILES[args.profile], args.seed)
        source = f"simulated extractor ({args.profile}), seed {args.seed}"
    ev = evaluate(documents, predictions)
    c, g = ev.calibration, ev.gate_at(REVIEW_THRESHOLD)
    if args.json:
        _emit(
            {
                "source": source,
                "documents": ev.documents,
                "truth_fields": ev.truth_fields,
                "precision": ev.overall.precision,
                "recall": ev.overall.recall,
                "f1": ev.overall.f1,
                "expected_calibration_error": c.expected_calibration_error,
                "brier_score": c.brier_score,
                "reliability": [
                    {
                        "bin": [b.lower, b.upper],
                        "count": b.count,
                        "mean_confidence": b.mean_confidence,
                        "accuracy": b.accuracy,
                    }
                    for b in c.bins
                    if b.count
                ],
                "gate": {
                    "threshold": g.threshold,
                    "sent_to_review": g.sent_to_review,
                    "escaped_errors": g.escaped_errors,
                    "catch_rate": g.catch_rate,
                },
            }
        )
        return 0
    print(f"Extraction evaluation: {source}")
    print(
        f"  {ev.documents} documents, {ev.truth_fields} truth fields, {ev.predictions} predictions"
    )
    o = ev.overall
    print(f"  precision {o.precision:.4f}  recall {o.recall:.4f}  F1 {o.f1:.4f}")
    print(f"  ECE {c.expected_calibration_error:.4f}  Brier {c.brier_score:.4f}")
    print("  confidence bin   fields  mean conf  accuracy")
    for b in c.bins:
        if b.count:
            print(
                f"  {b.lower:.1f} to {b.upper:.1f}    {b.count:>7}  {b.mean_confidence:>9.3f}  "
                f"{b.accuracy:>8.3f}"
            )
    print(
        f"  gate at {g.threshold}: {g.sent_to_review} to review, {g.escaped_errors} wrong values "
        f"accepted, {g.catch_rate:.1%} of wrong values caught"
    )
    return 0


def _cmd_constants(args: argparse.Namespace) -> int:
    if args.markdown:
        print(constants_markdown(), end="")
        return 0
    for row in constant_table():
        print(f"{row.path}\n    {row.value}\n    {row.source.label}")
    return 0


def _cmd_report(args: argparse.Namespace) -> int:
    from . import report  # noqa: PLC0415

    if args.check:
        stale = report.check(args.out)
        if stale:
            print(f"out of date in {args.out}: {', '.join(stale)}", file=sys.stderr)
            print("run: python -m taxline_quant report", file=sys.stderr)
            return 1
        print(f"{args.out / report.REPORT_NAME} is current")
        return 0
    for path in report.write(args.out):
        print(path)
    return 0


def _cmd_parity(args: argparse.Namespace) -> int:
    from . import parity  # noqa: PLC0415

    try:
        cases = [*parity.load_cases(), *parity.random_cases(args.seed, args.random)]
        theirs = parity.typescript_for_cases(cases)
    except parity.ParityUnavailableError as error:
        print(error, file=sys.stderr)
        return 2
    differences = [
        *parity.compare(parity.python_constants(), theirs["constants"], "constants"),
        *parity.compare_results(parity.python_results(cases), theirs["results"]),
    ]
    for line in differences[:50]:
        print(line)
    print(f"{len(cases)} cases, {len(differences)} differences")
    return 1 if differences else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="taxline_quant",
        description="TY2026 federal tax model, scenarios, and extraction evals. " + DISCLAIMER,
    )
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    tax = sub.add_parser("tax", help="estimate one return")
    _add_return_arguments(tax)
    tax.add_argument("--prior-year-tax", type=_money)
    tax.add_argument("--prior-year-agi", type=_money)
    tax.add_argument("--json", action="store_true")
    tax.set_defaults(run=_cmd_tax)

    sw = sub.add_parser("sweep", help="recompute the return over a range of one input")
    _add_return_arguments(sw)
    sw.add_argument("--vary", required=True, choices=sorted(f.replace("_", "-") for f in SWEEPABLE))
    sw.add_argument("--start", type=_money, required=True)
    sw.add_argument("--stop", type=_money, required=True)
    sw.add_argument("--step", type=_money, required=True)
    sw.add_argument("--json", action="store_true")
    sw.set_defaults(run=_cmd_sweep)

    mc = sub.add_parser("montecarlo", help="project estimated payments under profit uncertainty")
    _add_return_arguments(mc)
    mc.add_argument("--cv", type=_money, required=True, help="coefficient of variation of profit")
    mc.add_argument("--draws", type=int, default=10_000)
    mc.add_argument("--seed", type=int, default=20_260_415)
    mc.add_argument("--prior-year-tax", type=_money)
    mc.add_argument("--prior-year-agi", type=_money)
    mc.add_argument("--json", action="store_true")
    mc.set_defaults(run=_cmd_montecarlo)

    ev = sub.add_parser("eval", help="score field extraction against ground truth")
    ev.add_argument("--profile", choices=["calibrated", "overconfident"], default="overconfident")
    ev.add_argument("--documents", type=int, default=600)
    ev.add_argument("--seed", type=int, default=7)
    ev.add_argument("--truth", type=Path, help="ground truth JSON for a recorded run")
    ev.add_argument("--recorded", type=Path, help="recorded extraction JSON to score")
    ev.add_argument("--json", action="store_true")
    ev.set_defaults(run=_cmd_eval)

    const = sub.add_parser("constants", help="list every constant with its source")
    const.add_argument("--markdown", action="store_true")
    const.set_defaults(run=_cmd_constants)

    from .report import DEFAULT_DIR  # noqa: PLC0415

    rep = sub.add_parser("report", help="write the Markdown report and SVG charts")
    rep.add_argument("--out", type=Path, default=DEFAULT_DIR)
    rep.add_argument("--check", action="store_true", help="fail if the committed report is stale")
    rep.set_defaults(run=_cmd_report)

    par = sub.add_parser("parity", help="compare with the TypeScript engine (needs Node)")
    par.add_argument("--random", type=int, default=5_000, help="seeded random cases to add")
    par.add_argument("--seed", type=int, default=20_260_415)
    par.set_defaults(run=_cmd_parity)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result: int = args.run(args)
    except (ValueError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return result
