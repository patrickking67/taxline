"""Cross-check against the TypeScript engine in ``packages/tax-engine``.

Both implementations read the same case files. ``python_results`` runs the
cases through this package, ``typescript_results`` runs them through the
TypeScript engine with Node, and ``compare`` lists every field that differs.
Money must match to the cent; rates must match to 1e-9 (the TypeScript side
carries them as binary floats, this side to ten decimal places).
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import tempfile
from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

from .brackets import base_amounts
from .constants import TY2026, FilingStatus
from .estimated import estimated_tax
from .model import ReturnInput, compute_return

type Case = dict[str, Any]
type JsonObject = dict[str, Any]

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
ENGINE_DIR: Final = REPO_ROOT / "packages" / "tax-engine"
CASES_FILE: Final = ENGINE_DIR / "parity" / "cases.json"
DUMP_SCRIPT: Final = ENGINE_DIR / "parity" / "dump.ts"
TSX: Final = REPO_ROOT / "node_modules" / ".bin" / "tsx"

RATE_TOLERANCE: Final = Decimal("1e-9")
_RATE_FIELDS: Final = frozenset({"bracketRate", "marginalRate", "effectiveRate"})

# camelCase key in the shared case file -> ReturnInput field.
_MONEY_FIELDS: Final[Mapping[str, str]] = {
    "wages": "wages",
    "selfEmploymentProfit": "self_employment_profit",
    "otherIncome": "other_income",
    "adjustments": "adjustments",
    "itemized": "itemized",
    "federalWithholding": "federal_withholding",
    "estimatedPayments": "estimated_payments",
    "seOwnerSsWages": "se_owner_ss_wages",
    "medicareWages": "medicare_wages",
    "qbiW2Wages": "qbi_w2_wages",
    "qbiUbia": "qbi_ubia",
}
_FLAG_FIELDS: Final[Mapping[str, str]] = {"sstb": "sstb", "useTaxTable": "use_tax_table"}


class ParityUnavailableError(RuntimeError):
    """Node or the installed TypeScript toolchain is missing."""


def load_cases(path: Path = CASES_FILE) -> list[Case]:
    """Read a case file. Numbers are parsed as ``Decimal``, never as floats."""
    cases: list[Case] = json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal)
    return cases


def case_input(case: Case) -> ReturnInput:
    raw: Mapping[str, Any] = case["input"]
    unknown = set(raw) - set(_MONEY_FIELDS) - set(_FLAG_FIELDS) - {"status"}
    if unknown:
        raise ValueError(f"case {case['id']}: unsupported input {sorted(unknown)}")
    kwargs: dict[str, Any] = {"status": FilingStatus(raw["status"])}
    for key, name in _MONEY_FIELDS.items():
        if key in raw:
            kwargs[name] = Decimal(str(raw[key]))
    for key, name in _FLAG_FIELDS.items():
        if key in raw:
            kwargs[name] = bool(raw[key])
    return ReturnInput(**kwargs)


def python_result(case: Case) -> JsonObject:
    """One case through this package, in the shape ``dump.ts`` prints."""
    inputs = case_input(case)
    r = compute_return(inputs)
    prior: Mapping[str, Any] | None = case.get("prior")
    est = estimated_tax(
        inputs.status,
        r.total_tax,
        inputs.federal_withholding,
        prior_year_tax=Decimal(str(prior["tax"])) if prior else None,
        prior_year_agi=Decimal(str(prior["agi"])) if prior and "agi" in prior else None,
    )
    return {
        "id": case["id"],
        "totalIncome": r.total_income,
        "agi": r.agi,
        "deduction": r.deduction,
        "deductionKind": r.deduction_kind.value,
        "qbi": {
            "deduction": r.qbi.deduction,
            "tentative": r.qbi.tentative,
            "wageLimit": r.qbi.wage_limit,
            "incomeLimit": r.qbi.income_limit,
            "regime": r.qbi.regime.value,
            "minimumApplied": r.qbi.minimum_applied,
        },
        "taxable": r.taxable,
        "incomeTax": r.income_tax,
        "se": {
            "netEarnings": r.se.net_earnings,
            "ssTaxable": r.se.ss_taxable,
            "socialSecurity": r.se.social_security,
            "medicare": r.se.medicare,
            "total": r.se.total,
            "deduction": r.se.deduction,
        },
        "seTax": r.se.total,
        "addlMedicare": r.additional_medicare,
        "totalTax": r.total_tax,
        "payments": r.payments,
        "balance": r.balance,
        "bracketRate": r.bracket_rate,
        "marginalRate": r.marginal_rate,
        "effectiveRate": r.effective_rate,
        "estimated": {
            "required": est.required,
            "basis": est.basis.value,
            "currentYearTarget": est.current_year_target,
            "priorYearTarget": est.prior_year_target,
            "safeHarbor": est.safe_harbor,
            "dueFromEstimates": est.due_from_estimates,
            "installments": [i.amount for i in est.installments],
        },
    }


def python_results(cases: Iterable[Case]) -> list[JsonObject]:
    return [python_result(case) for case in cases]


def python_constants() -> JsonObject:
    """This package's TY2026 figures in the shape ``dump.ts`` prints."""
    y = TY2026

    def by_status(values: Mapping[FilingStatus, Decimal]) -> dict[str, Decimal]:
        return {s.value: values[s] for s in FilingStatus}

    return {
        "year": y.year,
        "brackets": {s.value: [[b.rate, b.floor] for b in y.brackets[s]] for s in FilingStatus},
        "baseAmounts": {s.value: list(base_amounts(y.brackets[s])) for s in FilingStatus},
        "standardDeduction": by_status(y.standard_deduction),
        "qbi": {
            "rate": y.qbi.rate,
            "threshold": by_status(y.qbi.threshold),
            "phaseInRange": by_status(y.qbi.phase_in_range),
            "minimumDeduction": y.qbi.minimum_deduction,
            "minimumQbi": y.qbi.minimum_qbi,
        },
        "fica": {
            "ssRate": y.se.social_security_rate,
            "medicareRate": y.se.medicare_rate,
            "wageBase": y.se.wage_base,
            "seNetFactor": y.se.net_earnings_factor,
        },
        "addlMedicare": {
            "rate": y.additional_medicare.rate,
            "threshold": by_status(y.additional_medicare.threshold),
        },
        "estimated": {
            "currentYearPct": y.estimated.current_year_pct,
            "priorYearPct": y.estimated.prior_year_pct,
            "priorYearHighPct": y.estimated.prior_year_high_pct,
            "highAgi": by_status(y.estimated.high_agi),
            "minimumBalanceDue": y.estimated.minimum_balance_due,
            "dueDates": list(y.estimated.due_dates),
        },
    }


def typescript_available() -> bool:
    return shutil.which("node") is not None and TSX.exists()


def typescript_output(cases_path: Path) -> JsonObject:
    """Run ``dump.ts`` on a case file and parse what it prints."""
    if not typescript_available():
        raise ParityUnavailableError(
            "Node and the repo's npm install are required: run `npm ci` at the repo root"
        )
    done = subprocess.run(
        [str(TSX), str(DUMP_SCRIPT), str(cases_path)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    if done.returncode != 0:
        raise RuntimeError(f"dump.ts failed ({done.returncode}): {done.stderr.strip()}")
    output: JsonObject = json.loads(done.stdout, parse_float=Decimal, parse_int=Decimal)
    return output


def typescript_for_cases(cases: Sequence[Case]) -> JsonObject:
    """Run in-memory cases through the TypeScript engine."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "cases.json"
        path.write_text(json.dumps(cases, default=_json_default), encoding="utf-8")
        return typescript_output(path)


def _json_default(value: object) -> object:
    if isinstance(value, Decimal):
        # Emit a JSON number, not a string: the TypeScript side takes numbers.
        return float(value) if value != value.to_integral_value() else int(value)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _differs(key: str, ours: object, theirs: object) -> bool:
    if isinstance(ours, bool) or isinstance(theirs, bool) or ours is None or theirs is None:
        return ours != theirs
    if isinstance(ours, Decimal | int) and isinstance(theirs, Decimal | int):
        a, b = Decimal(ours), Decimal(theirs)
        if key in _RATE_FIELDS:
            return abs(a - b) > RATE_TOLERANCE
        return a != b
    return ours != theirs


def _walk(prefix: str, ours: object, theirs: object) -> list[str]:
    if isinstance(ours, Mapping) and isinstance(theirs, Mapping):
        out: list[str] = []
        for key in sorted(set(ours) | set(theirs)):
            path = f"{prefix}.{key}" if prefix else str(key)
            if key not in ours or key not in theirs:
                out.append(f"{path}: present on one side only")
            else:
                out += _walk(path, ours[key], theirs[key])
        return out
    if isinstance(ours, list) and isinstance(theirs, list):
        if len(ours) != len(theirs):
            return [f"{prefix}: length {len(ours)} (python) vs {len(theirs)} (typescript)"]
        out = []
        for i, (a, b) in enumerate(zip(ours, theirs, strict=True)):
            out += _walk(f"{prefix}[{i}]", a, b)
        return out
    leaf = prefix.rsplit(".", 1)[-1].split("[", maxsplit=1)[0]
    if _differs(leaf, ours, theirs):
        return [f"{prefix}: python {ours} vs typescript {theirs}"]
    return []


def compare(ours: object, theirs: object, label: str = "") -> list[str]:
    """Every difference between two result trees, as readable lines."""
    return _walk(label, ours, theirs)


def compare_results(ours: Sequence[JsonObject], theirs: Sequence[JsonObject]) -> list[str]:
    if len(ours) != len(theirs):
        return [f"result count: python {len(ours)} vs typescript {len(theirs)}"]
    out: list[str] = []
    for a, b in zip(ours, theirs, strict=True):
        out += compare(a, b, str(a["id"]))
    return out


def _amount(rng: random.Random, low: int, high: int, cents: bool) -> Decimal:
    dollars = rng.randint(low, high)
    return Decimal(dollars) + (Decimal(rng.randint(0, 99)) / 100 if cents else 0)


def random_cases(seed: int, count: int) -> list[Case]:  # noqa: PLR0912
    """Seeded cases that spread across every regime the model has.

    Uses only ``random.Random`` integer draws, so a seed gives the same cases on
    every platform. Half the cases carry cents, which is where a binary-float
    engine and an exact one are most likely to part ways.
    """
    rng = random.Random(seed)
    statuses = [s.value for s in FilingStatus]
    cases: list[Case] = []
    for n in range(count):
        cents = rng.random() < 0.5
        status = rng.choice(statuses)
        shape = rng.choice(("wages", "se", "mixed", "high", "phase", "small"))
        raw: dict[str, Any] = {"status": status}
        if shape in ("wages", "mixed", "high"):
            raw["wages"] = _amount(rng, 0, 600_000 if shape == "high" else 160_000, cents)
        if shape in ("se", "mixed", "high"):
            raw["selfEmploymentProfit"] = _amount(
                rng, -20_000, 900_000 if shape == "high" else 220_000, cents
            )
        if shape == "phase":
            # Land taxable income near the sec. 199A threshold and range.
            threshold = int(TY2026.qbi.threshold[FilingStatus(status)])
            raw["selfEmploymentProfit"] = _amount(
                rng, threshold - 40_000, threshold + 160_000, cents
            )
            raw["qbiW2Wages"] = _amount(rng, 0, 120_000, cents)
            raw["qbiUbia"] = _amount(rng, 0, 400_000, cents)
        if shape == "small":
            raw["selfEmploymentProfit"] = _amount(rng, 0, 3_000, cents)
            raw["wages"] = _amount(rng, 0, 40_000, cents)
        if rng.random() < 0.3:
            raw["otherIncome"] = _amount(rng, 0, 50_000, cents)
        if rng.random() < 0.3:
            raw["adjustments"] = _amount(rng, 0, 20_000, cents)
        if rng.random() < 0.25:
            raw["itemized"] = _amount(rng, 0, 60_000, cents)
        if rng.random() < 0.5:
            raw["federalWithholding"] = _amount(rng, 0, 60_000, cents)
        if rng.random() < 0.2:
            raw["estimatedPayments"] = _amount(rng, 0, 40_000, cents)
        if "selfEmploymentProfit" in raw and rng.random() < 0.3:
            raw["sstb"] = True
        if "selfEmploymentProfit" in raw and status == "mfj" and rng.random() < 0.4:
            raw["seOwnerSsWages"] = _amount(rng, 0, 200_000, cents)
        if rng.random() < 0.15:
            raw["medicareWages"] = _amount(rng, 0, 400_000, cents)
        if rng.random() < 0.3:
            raw["useTaxTable"] = False
        case: Case = {"id": f"seed{seed}-{n}", "input": raw}
        if rng.random() < 0.6:
            prior: dict[str, Any] = {"tax": _amount(rng, 0, 150_000, cents)}
            if rng.random() < 0.7:
                prior["agi"] = _amount(rng, 0, 400_000, cents)
            case["prior"] = prior
        cases.append(case)
    return cases
