"""Form 1040 estimate for tax year 2026: income to refund or balance due.

::

    total income  = wages + self-employment profit + other ordinary income
    AGI           = total income - half of SE tax - other adjustments
    taxable       = max(0, AGI - max(standard, itemized) - QBI deduction)
    income tax    = Tax Table below $100,000, rate schedule at or above it
    total tax     = income tax + SE tax + Additional Medicare Tax
    balance       = withholding + estimated payments - total tax

What is modeled: the four filing statuses, the standard or an itemized
deduction, Schedule SE, the sec. 199A deduction for one business, and Form 8959.

What is not: capital gains and qualified dividends, credits, the net investment
income tax, the alternative minimum tax, and anything state or local. The
TypeScript engine in ``packages/tax-engine`` covers more of the return; this
model matches it to the cent on the inputs both accept, and the parity test in
``tests/test_parity.py`` enforces that.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import StrEnum

from .brackets import BracketSlice, bracket_rate, schedule_tax, slice_brackets, tax_table_tax
from .constants import TY2026, FilingStatus, TaxYear
from .money import ZERO, non_negative, ratio, round_cents, to_decimal
from .qbi import QbiDeduction, qbi_deduction
from .self_employment import SelfEmploymentTax, additional_medicare_tax, self_employment_tax

_MARGINAL_STEP = Decimal(100)


class DeductionKind(StrEnum):
    STANDARD = "standard"
    ITEMIZED = "itemized"


@dataclass(frozen=True, slots=True, kw_only=True)
class ReturnInput:
    """Inputs to the estimate. Amounts are annual dollars as ``Decimal``."""

    status: FilingStatus
    wages: Decimal = ZERO
    self_employment_profit: Decimal = ZERO
    """Schedule C net profit. May be negative: a loss offsets other income."""
    other_income: Decimal = ZERO
    """Other ordinary income that is neither wages nor investment income."""
    adjustments: Decimal = ZERO
    """Adjustments to income other than the half of SE tax."""
    itemized: Decimal = ZERO
    federal_withholding: Decimal = ZERO
    estimated_payments: Decimal = ZERO
    se_owner_ss_wages: Decimal | None = None
    """W-2 box 3 wages of the Schedule C owner. Defaults to ``wages`` except on a
    joint return, where a spouse's wages cannot be assumed to be the owner's."""
    medicare_wages: Decimal | None = None
    """W-2 box 5 wages for Form 8959. Defaults to ``wages``."""
    qbi_w2_wages: Decimal = ZERO
    qbi_ubia: Decimal = ZERO
    sstb: bool = False
    use_tax_table: bool = True

    def __post_init__(self) -> None:
        if not isinstance(self.status, FilingStatus):
            raise TypeError("status must be a FilingStatus")
        for name in (
            "wages",
            "other_income",
            "adjustments",
            "itemized",
            "federal_withholding",
            "estimated_payments",
            "qbi_w2_wages",
            "qbi_ubia",
        ):
            if to_decimal(getattr(self, name)) < 0:
                raise ValueError(f"{name} cannot be negative")
        to_decimal(self.self_employment_profit)
        for name in ("se_owner_ss_wages", "medicare_wages"):
            value = getattr(self, name)
            if value is not None and to_decimal(value) < 0:
                raise ValueError(f"{name} cannot be negative")


@dataclass(frozen=True, slots=True)
class Line:
    """One line of the estimate with the form line it lands on."""

    key: str
    label: str
    value: Decimal
    ref: str


@dataclass(frozen=True, slots=True, kw_only=True)
class ReturnResult:
    total_income: Decimal
    adjustments: Decimal
    agi: Decimal
    deduction: Decimal
    deduction_kind: DeductionKind
    qbi: QbiDeduction
    taxable: Decimal
    income_tax: Decimal
    se: SelfEmploymentTax
    additional_medicare: Decimal
    total_tax: Decimal
    payments: Decimal
    balance: Decimal
    """Positive: refund. Negative: balance due."""
    effective_rate: Decimal
    """Total tax over total income, to ten decimal places (0 when income is not positive)."""
    bracket_rate: Decimal
    """Statutory rate on the next dollar of taxable income."""
    marginal_rate: Decimal
    """Change in total tax per dollar on the next $100 of ordinary income, with
    every interaction included (SE tax is not, since the bump is not SE income)."""
    slices: tuple[BracketSlice, ...] = field(repr=False)

    def lines(self) -> tuple[Line, ...]:
        return (
            Line("total_income", "Total income", self.total_income, "1040 L9"),
            Line("adjustments", "Adjustments to income", self.adjustments, "1040 L10"),
            Line("agi", "Adjusted gross income", self.agi, "1040 L11"),
            Line(
                "deduction",
                "Standard deduction"
                if self.deduction_kind is DeductionKind.STANDARD
                else "Itemized deductions",
                self.deduction,
                "1040 L12",
            ),
            Line("qbi", "Qualified business income deduction", self.qbi.deduction, "1040 L13"),
            Line("taxable", "Taxable income", self.taxable, "1040 L15"),
            Line("income_tax", "Income tax", self.income_tax, "1040 L16"),
            Line("se_tax", "Self-employment tax", self.se.total, "Sch 2 L4"),
            Line(
                "additional_medicare",
                "Additional Medicare Tax",
                self.additional_medicare,
                "Sch 2 L11",
            ),
            Line("total_tax", "Total tax", self.total_tax, "1040 L24"),
            Line("payments", "Total payments", self.payments, "1040 L33"),
            Line(
                "balance",
                "Refund" if self.balance >= 0 else "Amount owed",
                abs(self.balance),
                "1040 L34" if self.balance >= 0 else "1040 L37",
            ),
        )


def compute_return(
    inputs: ReturnInput,
    year: TaxYear = TY2026,
    *,
    with_marginal: bool = True,
) -> ReturnResult:
    status = inputs.status
    wages = non_negative(inputs.wages)
    se_profit = to_decimal(inputs.self_employment_profit)
    other = non_negative(inputs.other_income)

    if inputs.se_owner_ss_wages is not None:
        owner_ss_wages = non_negative(inputs.se_owner_ss_wages)
    else:
        owner_ss_wages = ZERO if status is FilingStatus.MFJ else wages
    medicare_wages = (
        non_negative(inputs.medicare_wages) if inputs.medicare_wages is not None else wages
    )

    se = self_employment_tax(se_profit, owner_ss_wages, year)
    total_income = round_cents(wages + se_profit + other)
    adjustments = round_cents(se.deduction + non_negative(inputs.adjustments))
    agi = round_cents(max(ZERO, total_income - adjustments))

    standard = year.standard_deduction[status]
    itemized = non_negative(inputs.itemized)
    deduction_kind = DeductionKind.ITEMIZED if itemized > standard else DeductionKind.STANDARD
    deduction = max(standard, itemized)
    before_qbi = max(ZERO, agi - deduction)

    # QBI is net of the deductible half of SE tax (Reg. sec. 1.199A-3(b)(1)(vi)).
    qbi_income = max(ZERO, se_profit - se.deduction)
    qbi = qbi_deduction(
        status,
        qbi_income,
        before_qbi,
        w2_wages=non_negative(inputs.qbi_w2_wages),
        ubia=non_negative(inputs.qbi_ubia),
        sstb=inputs.sstb,
        year=year,
    )
    taxable = round_cents(max(ZERO, before_qbi - qbi.deduction))

    brackets = year.brackets[status]
    income_tax = (
        tax_table_tax(taxable, brackets, year.tax_table)
        if inputs.use_tax_table
        else schedule_tax(taxable, brackets)
    )
    additional_medicare = additional_medicare_tax(status, medicare_wages, se.net_earnings, year)
    total_tax = round_cents(income_tax + round_cents(se.total + additional_medicare))

    payments = round_cents(
        non_negative(inputs.federal_withholding) + non_negative(inputs.estimated_payments)
    )
    balance = round_cents(payments - total_tax)

    statutory = bracket_rate(taxable, brackets)
    marginal = statutory
    if with_marginal:
        # Finite difference on the exact rate schedule, so Tax Table row steps
        # do not distort it.
        exact = replace(inputs, use_tax_table=False)
        base = compute_return(exact, year, with_marginal=False)
        bumped = compute_return(
            replace(exact, other_income=other + _MARGINAL_STEP), year, with_marginal=False
        )
        marginal = ratio(bumped.total_tax - base.total_tax, _MARGINAL_STEP)

    return ReturnResult(
        total_income=total_income,
        adjustments=adjustments,
        agi=agi,
        deduction=deduction,
        deduction_kind=deduction_kind,
        qbi=qbi,
        taxable=taxable,
        income_tax=income_tax,
        se=se,
        additional_medicare=additional_medicare,
        total_tax=total_tax,
        payments=payments,
        balance=balance,
        effective_rate=ratio(total_tax, total_income) if total_income > 0 else ZERO,
        bracket_rate=statutory,
        marginal_rate=marginal,
        slices=slice_brackets(taxable, brackets),
    )
