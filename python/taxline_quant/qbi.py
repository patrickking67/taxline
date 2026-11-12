"""Qualified business income deduction (IRC sec. 199A), one trade or business.

Let ``T`` be taxable income before the deduction, ``theta`` the threshold,
``rho`` the phase-in range, and ``p = clamp((T - theta) / rho, 0, 1)``.
Tentative deduction = 20% of QBI. Wage limit
``W = max(50% wages, 25% wages + 2.5% UBIA)``::

    SSTB:       QBI, wages and UBIA are first scaled by (1 - p)   (sec. 199A(d)(3))
    p = 0:      component = tentative
    0 < p < 1:  component = tentative - p * max(0, tentative - W)  (sec. 199A(b)(3)(B))
    p = 1:      component = min(tentative, W)                      (sec. 199A(b)(2))

Deduction = min(component, 20% * (T - net capital gain)) (sec. 199A(a)), raised
to the $400 minimum when QBI is at least $1,000 (sec. 199A(i)).

Scope, stated plainly: one business, no REIT or PTP income, no loss carryovers,
no aggregation, and material participation is assumed for the minimum. The
minimum is capped at ``T`` so taxable income cannot go below zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from .constants import TY2026, FilingStatus, TaxYear
from .money import ZERO, clamp, div, mul, round_cents

_ONE = Decimal(1)


class QbiRegime(StrEnum):
    BELOW_THRESHOLD = "below-threshold"
    PHASE_IN = "phase-in"
    ABOVE_RANGE = "above-range"


@dataclass(frozen=True, slots=True)
class QbiDeduction:
    deduction: Decimal
    phase_in: Decimal
    """Position in the phase-in range, 0 to 1 (unrounded)."""
    tentative: Decimal
    wage_limit: Decimal
    income_limit: Decimal
    regime: QbiRegime
    minimum_applied: bool


def qbi_deduction(
    status: FilingStatus,
    qbi: Decimal,
    taxable_before_qbi: Decimal,
    *,
    net_capital_gain: Decimal = ZERO,
    w2_wages: Decimal = ZERO,
    ubia: Decimal = ZERO,
    sstb: bool = False,
    year: TaxYear = TY2026,
) -> QbiDeduction:
    p = year.qbi
    t = max(ZERO, taxable_before_qbi)
    phase = clamp(div(t - p.threshold[status], p.phase_in_range[status]), ZERO, _ONE)
    scale = _ONE - phase if sstb else _ONE
    q = mul(max(ZERO, qbi), scale)
    wages = mul(max(ZERO, w2_wages), scale)
    basis = mul(max(ZERO, ubia), scale)

    tentative = mul(p.rate, q)
    wage_limit = max(
        mul(p.wage_limit_wages_pct, wages),
        mul(p.wage_limit_alt_wages_pct, wages) + mul(p.wage_limit_alt_ubia_pct, basis),
    )
    if phase == 0:
        component = tentative
    elif phase < 1:
        component = tentative - mul(phase, max(ZERO, tentative - wage_limit))
    else:
        component = min(tentative, wage_limit)

    income_limit = mul(p.rate, max(ZERO, t - max(ZERO, net_capital_gain)))
    deduction = min(component, income_limit)
    minimum_applied = False
    # The minimum tests qualifying income after the SSTB exclusion, so a fully
    # phased-out specified service business gets nothing.
    if q >= p.minimum_qbi and deduction < p.minimum_deduction:
        deduction = min(p.minimum_deduction, t)
        minimum_applied = deduction > 0

    if phase == 0:
        regime = QbiRegime.BELOW_THRESHOLD
    elif phase < 1:
        regime = QbiRegime.PHASE_IN
    else:
        regime = QbiRegime.ABOVE_RANGE
    return QbiDeduction(
        deduction=round_cents(max(ZERO, deduction)),
        phase_in=phase,
        tentative=round_cents(tentative),
        wage_limit=round_cents(wage_limit),
        income_limit=round_cents(income_limit),
        regime=regime,
        minimum_applied=minimum_applied,
    )
