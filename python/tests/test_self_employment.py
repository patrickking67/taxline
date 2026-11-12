"""Schedule SE and Form 8959, hand-worked from the statutory rates."""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given

from taxline_quant import TY2026, FilingStatus, additional_medicare_tax, self_employment_tax
from taxline_quant.money import CENT

from .strategies import money, statuses

D = Decimal


def test_profit_of_100_000() -> None:
    se = self_employment_tax(D(100_000))
    assert se.net_earnings == D(92_350)
    assert se.social_security == D("11451.40")  # 92,350 x 12.4%
    assert se.medicare == D("2678.15")  # 92,350 x 2.9%
    assert se.total == D("14129.55")
    assert se.deduction == D("7064.78")  # 7,064.775 rounds up


def test_w2_wages_use_the_wage_base_first() -> None:
    se = self_employment_tax(D(50_000), w2_ss_wages=D(180_000))
    assert se.net_earnings == D(46_175)
    assert se.ss_taxable == D(4_500)  # 184,500 - 180,000
    assert se.social_security == D(558)
    assert se.medicare == D("1339.08")  # 1,339.075 rounds up
    assert se.total == D("1897.08")


def test_social_security_part_is_capped_at_the_wage_base() -> None:
    se = self_employment_tax(D(300_000))
    assert se.net_earnings == D(277_050)
    assert se.social_security == D(22_878)  # 184,500 x 12.4%
    assert se.medicare == D("8034.45")
    assert se.total == D("30912.45")


def test_the_400_dollar_floor() -> None:
    # 433 x 92.35% = 399.88: under the floor, no tax.
    under = self_employment_tax(D(433))
    assert under.net_earnings == D("399.88")
    assert not under.floor_met
    assert under.total == 0
    assert under.deduction == 0
    # 434 x 92.35% = 400.80: 49.70 + 11.62.
    over = self_employment_tax(D(434))
    assert over.floor_met
    assert over.total == D("61.32")


def test_half_cent_ties_round_up() -> None:
    # 134,850 x 0.9235 = 124,533.975 exactly.
    assert self_employment_tax(D(134_850)).net_earnings == D("124533.98")


def test_a_loss_owes_nothing() -> None:
    assert self_employment_tax(D(-25_000)).total == 0


def test_additional_medicare_tax() -> None:
    assert additional_medicare_tax(FilingStatus.SINGLE, D(300_000), D(0)) == D(900)
    # MFJ: wages of 200,000 leave 50,000 of the 250,000 threshold for SE earnings.
    assert additional_medicare_tax(FilingStatus.MFJ, D(200_000), D(92_350)) == D("381.15")
    # 15,395 x 0.9% = 138.555, a half-cent tie.
    assert additional_medicare_tax(FilingStatus.MFS, D(140_395), D(0)) == D("138.56")
    assert additional_medicare_tax(FilingStatus.SINGLE, D(150_000), D(40_000)) == 0


@given(money(), money(400_000))
def test_se_tax_invariants(profit: Decimal, wages: Decimal) -> None:
    p = TY2026.se
    se = self_employment_tax(profit, wages)
    assert se.total == se.social_security + se.medicare
    assert abs(se.deduction - se.total / 2) <= CENT / 2
    assert se.ss_taxable <= max(Decimal(0), p.wage_base - wages)
    assert se.social_security <= p.wage_base * p.social_security_rate
    assert se.total <= profit * p.net_earnings_factor * Decimal("0.153") + CENT
    if not se.floor_met:
        assert se.total == 0


@given(money(), money(50_000), money(400_000))
def test_se_tax_never_falls_as_profit_rises(
    profit: Decimal, extra: Decimal, wages: Decimal
) -> None:
    assert (
        self_employment_tax(profit, wages).total <= self_employment_tax(profit + extra, wages).total
    )


@given(statuses, money(), money())
def test_additional_medicare_is_bounded(status: FilingStatus, wages: Decimal, ne: Decimal) -> None:
    p = TY2026.additional_medicare
    tax = additional_medicare_tax(status, wages, ne)
    over = max(Decimal(0), wages + ne - p.threshold[status])
    assert tax >= 0
    assert abs(tax - over * p.rate) <= CENT / 2
