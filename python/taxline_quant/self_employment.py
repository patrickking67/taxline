"""Self-employment tax (Schedule SE) and the Additional Medicare Tax.

::

    NE  = 92.35% * net profit                 (sec. 1402(a)(12))
    SS  = 12.4% * min(NE, max(0, wage base - W-2 Social Security wages))
    Med = 2.9% * NE
    SE  = SS + Med;  deduction = SE / 2       (sec. 164(f), Schedule 1 line 15)

No self-employment tax is due when NE is under $400 (sec. 1402(b)(2)).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .constants import TY2026, FilingStatus, TaxYear
from .money import ZERO, mul, round_cents


@dataclass(frozen=True, slots=True)
class SelfEmploymentTax:
    net_earnings: Decimal
    ss_taxable: Decimal
    social_security: Decimal
    medicare: Decimal
    total: Decimal
    deduction: Decimal
    floor_met: bool


def self_employment_tax(
    net_profit: Decimal,
    w2_ss_wages: Decimal = ZERO,
    year: TaxYear = TY2026,
) -> SelfEmploymentTax:
    """Schedule SE for one person.

    ``w2_ss_wages`` are that person's W-2 box 3 wages; they use up the Social
    Security wage base before self-employment earnings do.
    """
    p = year.se
    profit = max(ZERO, net_profit)
    wages = max(ZERO, w2_ss_wages)
    net_earnings = round_cents(mul(profit, p.net_earnings_factor))
    floor_met = net_earnings >= p.floor
    room = max(ZERO, p.wage_base - wages)
    ss_taxable = min(net_earnings, room) if floor_met else ZERO
    social_security = round_cents(mul(ss_taxable, p.social_security_rate))
    medicare = round_cents(mul(net_earnings, p.medicare_rate)) if floor_met else ZERO
    total = round_cents(social_security + medicare)
    deduction = round_cents(mul(total, p.deduction_share))
    return SelfEmploymentTax(
        net_earnings=net_earnings,
        ss_taxable=ss_taxable,
        social_security=social_security,
        medicare=medicare,
        total=total,
        deduction=deduction,
        floor_met=floor_met,
    )


def additional_medicare_tax(
    status: FilingStatus,
    medicare_wages: Decimal,
    se_net_earnings: Decimal,
    year: TaxYear = TY2026,
) -> Decimal:
    """Form 8959: 0.9% on Medicare wages plus self-employment earnings over the threshold.

    Wages use the threshold first (Part I); self-employment earnings are tested
    against whatever threshold the wages left unused (Part II).
    """
    p = year.additional_medicare
    threshold = p.threshold[status]
    wages = max(ZERO, medicare_wages)
    on_wages = max(ZERO, wages - threshold)
    on_se = max(ZERO, max(ZERO, se_net_earnings) - max(ZERO, threshold - wages))
    return round_cents(mul(on_wages + on_se, p.rate))
