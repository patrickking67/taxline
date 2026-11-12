"""Required estimated tax and the IRC sec. 6654(d) safe harbor.

::

    current  = 90% of this year's total tax
    prior    = 100% of last year's tax (110% when prior-year AGI > $150,000; $75,000 MFS)
    required = min(current, prior)     (prior only if last year was a full 12-month return)
    due      = max(0, required - withholding), paid in four equal installments

No estimates are required when this year's tax less withholding is under $1,000
(sec. 6654(e)(1)) or when last year's tax was zero on a full-year return
(sec. 6654(e)(2)).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from .constants import TY2026, FilingStatus, TaxYear
from .money import ZERO, mul, round_cents


class SafeHarborBasis(StrEnum):
    CURRENT_YEAR = "current-year"
    PRIOR_YEAR = "prior-year"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class Installment:
    number: int
    due: str
    amount: Decimal


@dataclass(frozen=True, slots=True)
class EstimatedTax:
    required: bool
    reason: str
    basis: SafeHarborBasis
    current_year_target: Decimal
    prior_year_target: Decimal | None
    safe_harbor: Decimal
    due_from_estimates: Decimal
    installments: tuple[Installment, ...]


def estimated_tax(
    status: FilingStatus,
    current_year_tax: Decimal,
    withholding: Decimal = ZERO,
    *,
    prior_year_tax: Decimal | None = None,
    prior_year_agi: Decimal | None = None,
    prior_year_full: bool = True,
    year: TaxYear = TY2026,
) -> EstimatedTax:
    """The required annual payment and its four installments.

    When ``prior_year_agi`` is unknown the 110% test is assumed, so the result
    never understates the safe harbor.
    """
    p = year.estimated
    tax = max(ZERO, current_year_tax)
    withheld = max(ZERO, withholding)
    current_target = round_cents(mul(tax, p.current_year_pct))
    has_prior = prior_year_full and prior_year_tax is not None
    high_income = prior_year_agi is None or prior_year_agi > p.high_agi[status]
    prior_pct = p.prior_year_high_pct if high_income else p.prior_year_pct
    prior_target = (
        round_cents(mul(max(ZERO, prior_year_tax), prior_pct))
        if has_prior and prior_year_tax is not None
        else None
    )

    safe_harbor = current_target if prior_target is None else min(current_target, prior_target)
    basis = (
        SafeHarborBasis.PRIOR_YEAR
        if prior_target is not None and prior_target < current_target
        else SafeHarborBasis.CURRENT_YEAR
    )

    required = True
    reason = "Withholding does not cover the safe harbor."
    if tax - withheld < p.minimum_balance_due:
        required = False
        reason = f"Tax after withholding is under ${p.minimum_balance_due:,.0f}."
    elif has_prior and prior_year_tax == 0:
        required = False
        reason = "Prior-year tax was zero on a full-year return."
    elif withheld >= safe_harbor:
        required = False
        reason = "Withholding already meets the safe harbor."

    due = round_cents(max(ZERO, safe_harbor - withheld)) if required else ZERO
    per = round_cents(due / 4)
    # The last installment absorbs rounding so the four sum exactly.
    amounts = (per, per, per, round_cents(due - per * 3))
    installments = tuple(
        Installment(number=k + 1, due=date, amount=amounts[k]) for k, date in enumerate(p.due_dates)
    )
    return EstimatedTax(
        required=required,
        reason=reason,
        basis=basis if required else SafeHarborBasis.NONE,
        current_year_target=current_target,
        prior_year_target=prior_target,
        safe_harbor=safe_harbor,
        due_from_estimates=due,
        installments=installments,
    )
