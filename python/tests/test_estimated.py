"""Section 6654 safe harbor, hand-worked."""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from taxline_quant import TY2026, FilingStatus, SafeHarborBasis, estimated_tax

from .strategies import money, statuses

D = Decimal
SINGLE = FilingStatus.SINGLE


def test_prior_year_safe_harbor() -> None:
    e = estimated_tax(
        SINGLE, D(20_000), D(5_000), prior_year_tax=D(15_000), prior_year_agi=D(100_000)
    )
    assert e.current_year_target == D(18_000)
    assert e.prior_year_target == D(15_000)
    assert e.safe_harbor == D(15_000)
    assert e.basis is SafeHarborBasis.PRIOR_YEAR
    assert e.due_from_estimates == D(10_000)
    assert [i.amount for i in e.installments] == [D(2_500)] * 4
    assert [i.due for i in e.installments] == list(TY2026.estimated.due_dates)


def test_high_prior_year_agi_uses_110_percent() -> None:
    e = estimated_tax(
        SINGLE, D(20_000), D(5_000), prior_year_tax=D(15_000), prior_year_agi=D(200_000)
    )
    assert e.prior_year_target == D(16_500)
    assert e.due_from_estimates == D(11_500)
    # MFS: the higher share starts at 75,000.
    mfs = estimated_tax(
        FilingStatus.MFS, D(20_000), prior_year_tax=D(10_000), prior_year_agi=D(80_000)
    )
    assert mfs.prior_year_target == D(11_000)


def test_unknown_prior_year_agi_assumes_110_percent() -> None:
    e = estimated_tax(SINGLE, D(20_000), prior_year_tax=D(10_000))
    assert e.prior_year_target == D(11_000)


def test_no_estimates_when_the_balance_is_small() -> None:
    e = estimated_tax(SINGLE, D(5_500), D(4_800), prior_year_tax=D(9_000))
    assert not e.required
    assert e.basis is SafeHarborBasis.NONE
    assert e.due_from_estimates == 0


def test_no_estimates_after_a_zero_tax_year() -> None:
    e = estimated_tax(SINGLE, D(12_000), prior_year_tax=D(0), prior_year_agi=D(20_000))
    assert not e.required
    # A short prior year does not count.
    short = estimated_tax(SINGLE, D(12_000), prior_year_tax=D(0), prior_year_full=False)
    assert short.required
    assert short.safe_harbor == D(10_800)


def test_current_year_only_without_a_prior_return() -> None:
    e = estimated_tax(SINGLE, D("43230.95"))
    # 43,230.95 x 90% = 38,907.855, a half-cent tie that rounds up.
    assert e.current_year_target == D("38907.86")
    assert e.prior_year_target is None
    assert e.basis is SafeHarborBasis.CURRENT_YEAR


def test_last_installment_absorbs_rounding() -> None:
    # Safe harbor 100.01: three installments of 25.00 and one of 25.01.
    e = estimated_tax(SINGLE, D("1111.23"), prior_year_tax=D("100.01"), prior_year_agi=D(50_000))
    assert e.due_from_estimates == D("100.01")
    assert [i.amount for i in e.installments] == [D("25.00"), D("25.00"), D("25.00"), D("25.01")]


@given(
    statuses,
    money(),
    money(300_000),
    st.none() | money(),
    st.none() | money(),
    st.booleans(),
)
def test_safe_harbor_invariants(
    status: FilingStatus,
    tax: Decimal,
    withholding: Decimal,
    prior_tax: Decimal | None,
    prior_agi: Decimal | None,
    prior_full: bool,
) -> None:
    e = estimated_tax(
        status,
        tax,
        withholding,
        prior_year_tax=prior_tax,
        prior_year_agi=prior_agi,
        prior_year_full=prior_full,
    )
    assert e.safe_harbor <= e.current_year_target
    assert sum(i.amount for i in e.installments) == e.due_from_estimates
    assert e.due_from_estimates >= 0
    assert all(i.amount >= 0 for i in e.installments)
    if e.required:
        assert e.due_from_estimates == max(D(0), e.safe_harbor - withholding)
    else:
        assert e.due_from_estimates == 0
        assert e.basis is SafeHarborBasis.NONE
