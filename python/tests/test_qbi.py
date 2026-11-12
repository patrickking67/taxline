"""Section 199A, hand-worked."""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from taxline_quant import TY2026, FilingStatus, QbiRegime, qbi_deduction
from taxline_quant.money import CENT

from .strategies import money, statuses

D = Decimal
SINGLE = FilingStatus.SINGLE


def test_below_the_threshold_it_is_twenty_percent() -> None:
    r = qbi_deduction(SINGLE, D(80_000), D(120_000))
    assert r.regime is QbiRegime.BELOW_THRESHOLD
    assert r.deduction == D(16_000)


def test_limited_to_twenty_percent_of_taxable_income() -> None:
    r = qbi_deduction(SINGLE, D(80_000), D(50_000))
    assert r.tentative == D(16_000)
    assert r.income_limit == D(10_000)
    assert r.deduction == D(10_000)


def test_halfway_through_the_phase_in() -> None:
    # 201,750 + 37,500: p = 0.5. Tentative 40,000, wage limit 10,000.
    r = qbi_deduction(SINGLE, D(200_000), D(239_250), w2_wages=D(20_000))
    assert r.phase_in == D("0.5")
    assert r.regime is QbiRegime.PHASE_IN
    assert r.wage_limit == D(10_000)
    assert r.deduction == D(25_000)  # 40,000 - 0.5 x 30,000


def test_sstb_halfway_through_the_phase_in() -> None:
    # QBI and wages are halved first: tentative 20,000, wage limit 5,000.
    r = qbi_deduction(SINGLE, D(200_000), D(239_250), w2_wages=D(20_000), sstb=True)
    assert r.deduction == D(12_500)  # 20,000 - 0.5 x 15,000


def test_above_the_range_the_wage_limit_binds() -> None:
    # max(50% x 20,000, 25% x 20,000 + 2.5% x 1,000,000) = 30,000
    r = qbi_deduction(SINGLE, D(200_000), D(300_000), w2_wages=D(20_000), ubia=D(1_000_000))
    assert r.regime is QbiRegime.ABOVE_RANGE
    assert r.wage_limit == D(30_000)
    assert r.deduction == D(30_000)


def test_sstb_above_the_range_gets_nothing() -> None:
    r = qbi_deduction(SINGLE, D(200_000), D(300_000), sstb=True)
    assert r.deduction == 0
    assert not r.minimum_applied


def test_the_400_dollar_minimum() -> None:
    small = qbi_deduction(SINGLE, D(1_500), D(50_000))
    assert small.deduction == D(400)  # 20% x 1,500 = 300, raised to the minimum
    assert small.minimum_applied
    # Under $1,000 of QBI the minimum does not apply.
    assert qbi_deduction(SINGLE, D(999), D(50_000)).deduction == D("199.80")
    # The minimum cannot push taxable income below zero.
    assert qbi_deduction(SINGLE, D(1_500), D(250)).deduction == D(250)


def test_threshold_edges_by_status() -> None:
    assert (
        qbi_deduction(FilingStatus.MFJ, D(100_000), D(403_500)).regime is QbiRegime.BELOW_THRESHOLD
    )
    assert qbi_deduction(FilingStatus.MFJ, D(100_000), D(403_501)).regime is QbiRegime.PHASE_IN
    assert qbi_deduction(FilingStatus.MFJ, D(100_000), D(553_500)).regime is QbiRegime.ABOVE_RANGE
    assert qbi_deduction(FilingStatus.MFS, D(100_000), D(201_775)).regime is (
        QbiRegime.BELOW_THRESHOLD
    )


@given(statuses, money(), money(), money(500_000), money(2_000_000), st.booleans())
def test_deduction_bounds(
    status: FilingStatus,
    qbi: Decimal,
    taxable: Decimal,
    wages: Decimal,
    ubia: Decimal,
    sstb: bool,
) -> None:
    p = TY2026.qbi
    r = qbi_deduction(status, qbi, taxable, w2_wages=wages, ubia=ubia, sstb=sstb)
    assert 0 <= r.deduction <= taxable + CENT
    assert r.deduction <= max(qbi * p.rate, p.minimum_deduction) + CENT
    assert 0 <= r.phase_in <= 1
    if not r.minimum_applied:
        assert r.deduction <= r.income_limit
        assert r.deduction <= r.tentative


@given(statuses, money(), money(), money(500_000), money(2_000_000))
def test_an_sstb_never_gets_more_than_the_same_business_would(
    status: FilingStatus, qbi: Decimal, taxable: Decimal, wages: Decimal, ubia: Decimal
) -> None:
    plain = qbi_deduction(status, qbi, taxable, w2_wages=wages, ubia=ubia)
    sstb = qbi_deduction(status, qbi, taxable, w2_wages=wages, ubia=ubia, sstb=True)
    assert sstb.deduction <= plain.deduction


@given(statuses, money(), money(), money(500_000))
def test_more_wages_never_reduce_the_deduction(
    status: FilingStatus, qbi: Decimal, taxable: Decimal, wages: Decimal
) -> None:
    low = qbi_deduction(status, qbi, taxable, w2_wages=wages)
    high = qbi_deduction(status, qbi, taxable, w2_wages=wages + 10_000)
    assert low.deduction <= high.deduction
