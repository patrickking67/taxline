"""Tax year 2026 federal parameters, each with its primary source.

Indexed figures are transcribed from Rev. Proc. 2025-32 (IRS, 2025), which
reflects the amendments made by Pub. L. 119-21 (the "One Big Beautiful Bill
Act", OBBBA). Rates and thresholds fixed in the Internal Revenue Code are cited
to the Code section. ``constant_table`` lists every figure with its source; the
table in ``docs/quant/constants.md`` is generated from it and a test keeps the
two in step.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType

TAX_YEAR = 2026


class FilingStatus(StrEnum):
    SINGLE = "single"
    MFJ = "mfj"
    MFS = "mfs"
    HOH = "hoh"


STATUS_LABELS: Mapping[FilingStatus, str] = MappingProxyType(
    {
        FilingStatus.SINGLE: "Single",
        FilingStatus.MFJ: "Married filing jointly",
        FilingStatus.MFS: "Married filing separately",
        FilingStatus.HOH: "Head of household",
    }
)


@dataclass(frozen=True, slots=True)
class Source:
    """A primary source for a figure."""

    label: str
    url: str


_REV_PROC_URL = "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf"
_USC = "https://www.law.cornell.edu/uscode/text/26/"

SRC_BRACKETS = Source("Rev. Proc. 2025-32 sec. 4.01, Tables 1-4; IRC sec. 1(j)(2)", _REV_PROC_URL)
SRC_STANDARD = Source("Rev. Proc. 2025-32 sec. 4.14(1); IRC sec. 63(c)(2)", _REV_PROC_URL)
SRC_QBI_INDEXED = Source(
    "Rev. Proc. 2025-32 sec. 4.26; IRC sec. 199A(e)(2), (b)(3)(B)", _REV_PROC_URL
)
# The phase-in range is set by statute, not indexed: Pub. L. 119-21 widened it to
# $75,000 ($150,000 joint) for tax years after 2025.
SRC_QBI_RANGE = Source(
    "IRC sec. 199A(b)(3)(B), (d)(3)(A), as amended by Pub. L. 119-21 sec. 70105(a); "
    "Rev. Proc. 2025-32 sec. 4.26",
    _REV_PROC_URL,
)
SRC_QBI_RATE = Source("IRC sec. 199A(a), (b)(2)", _USC + "199A")
SRC_QBI_MINIMUM = Source(
    "IRC sec. 199A(i), as amended by Pub. L. 119-21 sec. 70105(b); Rev. Proc. 2025-32 sec. 2.12",
    _REV_PROC_URL,
)
SRC_SE_RATES = Source("IRC sec. 1401(a), (b)(1); Schedule SE (Form 1040) (2026)", _USC + "1401")
SRC_SE_FACTOR = Source("IRC sec. 1402(a)(12); Schedule SE (2026) line 4a", _USC + "1402")
SRC_SE_FLOOR = Source("IRC sec. 1402(b)(2); Schedule SE (2026) line 4c", _USC + "1402")
SRC_SE_DEDUCTION = Source(
    "IRC sec. 164(f); Schedule SE (2026) line 13, carried to Schedule 1 (Form 1040) line 15",
    _USC + "164",
)
SRC_WAGE_BASE = Source(
    "SSA, Cost-of-Living Increase and Other Determinations for 2026, 90 FR 49047 "
    "(2025-11-03); IRC sec. 1402(b)(1); Schedule SE (2026) line 7",
    "https://www.federalregister.gov/documents/2025/11/03/2025-19763/"
    "cost-of-living-increase-and-other-determinations-for-2026",
)
SRC_ADDL_MEDICARE = Source("IRC sec. 1401(b)(2), sec. 3101(b)(2); Form 8959 (2025)", _USC + "1401")
SRC_ESTIMATED = Source("IRC sec. 6654(d)(1)(B), (C); Form 1040-ES (2026)", _USC + "6654")
SRC_ESTIMATED_MINIMUM = Source("IRC sec. 6654(e)(1)", _USC + "6654")
SRC_ESTIMATED_DATES = Source("IRC sec. 6654(c)(2); Form 1040-ES (2026)", _USC + "6654")
# The TY2026 Form 1040 instructions were not published when this was last checked
# (2026-11-12). The row layout is the TY2025 one, including the three irregular rows
# at the bottom ($0-5, $5-15, $15-25) that brackets.tax_table_tax handles in place.
SRC_TAX_TABLE = Source(
    "IRC sec. 3; Form 1040 instructions (2025), Tax Table (row layout; TY2026 not yet published)",
    "https://www.irs.gov/instructions/i1040gi",
)


@dataclass(frozen=True, slots=True)
class Bracket:
    """One rate band: taxable income above ``floor`` is taxed at ``rate``."""

    rate: Decimal
    floor: Decimal


def _schedule(*rows: tuple[str, int]) -> tuple[Bracket, ...]:
    return tuple(Bracket(Decimal(rate), Decimal(floor)) for rate, floor in rows)


def _by_status(single: int, mfj: int, mfs: int, hoh: int) -> Mapping[FilingStatus, Decimal]:
    return MappingProxyType(
        {
            FilingStatus.SINGLE: Decimal(single),
            FilingStatus.MFJ: Decimal(mfj),
            FilingStatus.MFS: Decimal(mfs),
            FilingStatus.HOH: Decimal(hoh),
        }
    )


@dataclass(frozen=True, slots=True)
class QbiParams:
    rate: Decimal
    threshold: Mapping[FilingStatus, Decimal]
    phase_in_range: Mapping[FilingStatus, Decimal]
    wage_limit_wages_pct: Decimal
    wage_limit_alt_wages_pct: Decimal
    wage_limit_alt_ubia_pct: Decimal
    minimum_deduction: Decimal
    minimum_qbi: Decimal


@dataclass(frozen=True, slots=True)
class SeParams:
    social_security_rate: Decimal
    medicare_rate: Decimal
    net_earnings_factor: Decimal
    wage_base: Decimal
    floor: Decimal
    deduction_share: Decimal


@dataclass(frozen=True, slots=True)
class AdditionalMedicareParams:
    rate: Decimal
    threshold: Mapping[FilingStatus, Decimal]


@dataclass(frozen=True, slots=True)
class EstimatedParams:
    current_year_pct: Decimal
    prior_year_pct: Decimal
    prior_year_high_pct: Decimal
    high_agi: Mapping[FilingStatus, Decimal]
    minimum_balance_due: Decimal
    due_dates: tuple[str, str, str, str]


@dataclass(frozen=True, slots=True)
class TaxTableParams:
    """Tax Table row layout: taxable income under ``ceiling`` is taxed at a row midpoint."""

    ceiling: Decimal
    row_width: Decimal
    small_row_width: Decimal
    small_row_ceiling: Decimal


@dataclass(frozen=True, slots=True)
class TaxYear:
    year: int
    brackets: Mapping[FilingStatus, tuple[Bracket, ...]]
    standard_deduction: Mapping[FilingStatus, Decimal]
    qbi: QbiParams
    se: SeParams
    additional_medicare: AdditionalMedicareParams
    estimated: EstimatedParams
    tax_table: TaxTableParams


TY2026 = TaxYear(
    year=TAX_YEAR,
    brackets=MappingProxyType(
        {
            # Rev. Proc. 2025-32 sec. 4.01, Table 3 (unmarried individuals).
            FilingStatus.SINGLE: _schedule(
                ("0.10", 0),
                ("0.12", 12_400),
                ("0.22", 50_400),
                ("0.24", 105_700),
                ("0.32", 201_775),
                ("0.35", 256_225),
                ("0.37", 640_600),
            ),
            # Table 1 (married filing jointly and surviving spouses).
            FilingStatus.MFJ: _schedule(
                ("0.10", 0),
                ("0.12", 24_800),
                ("0.22", 100_800),
                ("0.24", 211_400),
                ("0.32", 403_550),
                ("0.35", 512_450),
                ("0.37", 768_700),
            ),
            # Table 4 (married filing separately).
            FilingStatus.MFS: _schedule(
                ("0.10", 0),
                ("0.12", 12_400),
                ("0.22", 50_400),
                ("0.24", 105_700),
                ("0.32", 201_775),
                ("0.35", 256_225),
                ("0.37", 384_350),
            ),
            # Table 2 (heads of households).
            FilingStatus.HOH: _schedule(
                ("0.10", 0),
                ("0.12", 17_700),
                ("0.22", 67_450),
                ("0.24", 105_700),
                ("0.32", 201_750),
                ("0.35", 256_200),
                ("0.37", 640_600),
            ),
        }
    ),
    standard_deduction=_by_status(single=16_100, mfj=32_200, mfs=16_100, hoh=24_150),
    qbi=QbiParams(
        rate=Decimal("0.20"),
        threshold=_by_status(single=201_750, mfj=403_500, mfs=201_775, hoh=201_750),
        # Rev. Proc. 2025-32 prints the top of the range (276,750 / 553,500 /
        # 276,775); the width is that figure less the threshold.
        phase_in_range=_by_status(single=75_000, mfj=150_000, mfs=75_000, hoh=75_000),
        wage_limit_wages_pct=Decimal("0.50"),
        wage_limit_alt_wages_pct=Decimal("0.25"),
        wage_limit_alt_ubia_pct=Decimal("0.025"),
        minimum_deduction=Decimal(400),
        minimum_qbi=Decimal(1_000),
    ),
    se=SeParams(
        social_security_rate=Decimal("0.124"),
        medicare_rate=Decimal("0.029"),
        net_earnings_factor=Decimal("0.9235"),
        wage_base=Decimal(184_500),
        floor=Decimal(400),
        deduction_share=Decimal("0.5"),
    ),
    additional_medicare=AdditionalMedicareParams(
        rate=Decimal("0.009"),
        threshold=_by_status(single=200_000, mfj=250_000, mfs=125_000, hoh=200_000),
    ),
    estimated=EstimatedParams(
        current_year_pct=Decimal("0.90"),
        prior_year_pct=Decimal("1.00"),
        prior_year_high_pct=Decimal("1.10"),
        high_agi=_by_status(single=150_000, mfj=150_000, mfs=75_000, hoh=150_000),
        minimum_balance_due=Decimal(1_000),
        due_dates=("2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"),
    ),
    tax_table=TaxTableParams(
        ceiling=Decimal(100_000),
        row_width=Decimal(50),
        small_row_width=Decimal(25),
        small_row_ceiling=Decimal(3_000),
    ),
)


@dataclass(frozen=True, slots=True)
class ConstantRow:
    """One documented figure: where it lives, what it is, and who says so."""

    path: str
    description: str
    value: str
    source: Source


def _usd(value: Decimal) -> str:
    return f"${value:,.0f}"


def _pct(value: Decimal) -> str:
    return f"{(value * 100).normalize():f}%"


def _status_values(values: Mapping[FilingStatus, Decimal]) -> str:
    return "; ".join(f"{status.value} {_usd(values[status])}" for status in FilingStatus)


def constant_table(year: TaxYear = TY2026) -> tuple[ConstantRow, ...]:
    """Every figure the model reads, with its source. Order follows the calculation."""
    rows: list[ConstantRow] = []
    for status in FilingStatus:
        bands = ", ".join(f"{_pct(b.rate)} from {_usd(b.floor)}" for b in year.brackets[status])
        rows.append(
            ConstantRow(
                f"brackets.{status.value}",
                f"Rate schedule, {STATUS_LABELS[status].lower()}",
                bands,
                SRC_BRACKETS,
            )
        )
    q, se, am, est, tt = (
        year.qbi,
        year.se,
        year.additional_medicare,
        year.estimated,
        year.tax_table,
    )
    rows += [
        ConstantRow(
            "standard_deduction",
            "Standard deduction",
            _status_values(year.standard_deduction),
            SRC_STANDARD,
        ),
        ConstantRow("qbi.rate", "QBI deduction rate", _pct(q.rate), SRC_QBI_RATE),
        ConstantRow(
            "qbi.threshold",
            "QBI threshold amount (taxable income before the deduction)",
            _status_values(q.threshold),
            SRC_QBI_INDEXED,
        ),
        ConstantRow(
            "qbi.phase_in_range",
            "QBI phase-in range width above the threshold",
            _status_values(q.phase_in_range),
            SRC_QBI_RANGE,
        ),
        ConstantRow(
            "qbi.wage_limit_wages_pct",
            "W-2 wage limit, wages-only test",
            _pct(q.wage_limit_wages_pct),
            SRC_QBI_RATE,
        ),
        ConstantRow(
            "qbi.wage_limit_alt_wages_pct",
            "W-2 wage limit, wages share of the wages-and-property test",
            _pct(q.wage_limit_alt_wages_pct),
            SRC_QBI_RATE,
        ),
        ConstantRow(
            "qbi.wage_limit_alt_ubia_pct",
            "W-2 wage limit, share of unadjusted basis of qualified property",
            _pct(q.wage_limit_alt_ubia_pct),
            SRC_QBI_RATE,
        ),
        ConstantRow(
            "qbi.minimum_deduction",
            "Minimum QBI deduction for an active business",
            _usd(q.minimum_deduction),
            SRC_QBI_MINIMUM,
        ),
        ConstantRow(
            "qbi.minimum_qbi",
            "QBI needed to qualify for the minimum deduction",
            _usd(q.minimum_qbi),
            SRC_QBI_MINIMUM,
        ),
        ConstantRow(
            "se.social_security_rate",
            "Self-employment tax, Social Security (OASDI) rate",
            _pct(se.social_security_rate),
            SRC_SE_RATES,
        ),
        ConstantRow(
            "se.medicare_rate",
            "Self-employment tax, Medicare (HI) rate",
            _pct(se.medicare_rate),
            SRC_SE_RATES,
        ),
        ConstantRow(
            "se.net_earnings_factor",
            "Net earnings from self-employment as a share of net profit",
            _pct(se.net_earnings_factor),
            SRC_SE_FACTOR,
        ),
        ConstantRow(
            "se.wage_base",
            "Social Security contribution and benefit base",
            _usd(se.wage_base),
            SRC_WAGE_BASE,
        ),
        ConstantRow(
            "se.floor",
            "Net earnings below which no self-employment tax is due",
            _usd(se.floor),
            SRC_SE_FLOOR,
        ),
        ConstantRow(
            "se.deduction_share",
            "Deductible share of self-employment tax",
            _pct(se.deduction_share),
            SRC_SE_DEDUCTION,
        ),
        ConstantRow(
            "additional_medicare.rate",
            "Additional Medicare Tax rate",
            _pct(am.rate),
            SRC_ADDL_MEDICARE,
        ),
        ConstantRow(
            "additional_medicare.threshold",
            "Additional Medicare Tax threshold (not indexed)",
            _status_values(am.threshold),
            SRC_ADDL_MEDICARE,
        ),
        ConstantRow(
            "estimated.current_year_pct",
            "Safe harbor, share of current-year tax",
            _pct(est.current_year_pct),
            SRC_ESTIMATED,
        ),
        ConstantRow(
            "estimated.prior_year_pct",
            "Safe harbor, share of prior-year tax",
            _pct(est.prior_year_pct),
            SRC_ESTIMATED,
        ),
        ConstantRow(
            "estimated.prior_year_high_pct",
            "Safe harbor, share of prior-year tax when prior-year AGI is high",
            _pct(est.prior_year_high_pct),
            SRC_ESTIMATED,
        ),
        ConstantRow(
            "estimated.high_agi",
            "Prior-year AGI above which the higher share applies",
            _status_values(est.high_agi),
            SRC_ESTIMATED,
        ),
        ConstantRow(
            "estimated.minimum_balance_due",
            "Tax after withholding below which no estimates are required",
            _usd(est.minimum_balance_due),
            SRC_ESTIMATED_MINIMUM,
        ),
        ConstantRow(
            "estimated.due_dates",
            "Installment due dates",
            ", ".join(est.due_dates),
            SRC_ESTIMATED_DATES,
        ),
        ConstantRow(
            "tax_table.ceiling",
            "Taxable income below which the Tax Table applies",
            _usd(tt.ceiling),
            SRC_TAX_TABLE,
        ),
        ConstantRow(
            "tax_table.row_width",
            "Tax Table row width at or above the small-row ceiling",
            _usd(tt.row_width),
            SRC_TAX_TABLE,
        ),
        ConstantRow(
            "tax_table.small_row_width",
            "Tax Table row width below the small-row ceiling",
            _usd(tt.small_row_width),
            SRC_TAX_TABLE,
        ),
        ConstantRow(
            "tax_table.small_row_ceiling",
            "Taxable income below which rows are narrower",
            _usd(tt.small_row_ceiling),
            SRC_TAX_TABLE,
        ),
    ]
    return tuple(rows)


def constants_markdown(year: TaxYear = TY2026) -> str:
    """The citation table as Markdown, for ``docs/quant/constants.md``."""
    lines = [
        f"# Tax year {year.year} constants",
        "",
        "Generated by `python -m taxline_quant constants --markdown`. Do not edit by hand;",
        "a test fails when this file and `taxline_quant/constants.py` disagree.",
        "",
        "| Constant | What it is | Value | Source |",
        "| --- | --- | --- | --- |",
    ]
    for row in constant_table(year):
        source = f"[{row.source.label}]({row.source.url})"
        lines.append(f"| `{row.path}` | {row.description} | {row.value} | {source} |")
    return "\n".join(lines) + "\n"
