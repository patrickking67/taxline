"""Rate schedule and Tax Table. Expected values are worked by hand from the
Rev. Proc. 2025-32 tables."""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from taxline_quant import (
    TY2026,
    FilingStatus,
    base_amounts,
    bracket_rate,
    schedule_tax,
    slice_brackets,
    tax_table_tax,
)
from taxline_quant.money import CENT

from .strategies import money, statuses

SINGLE = TY2026.brackets[FilingStatus.SINGLE]
MFJ = TY2026.brackets[FilingStatus.MFJ]
HOH = TY2026.brackets[FilingStatus.HOH]
TOP_RATE = Decimal("0.37")


def test_rate_schedule_hand_worked() -> None:
    # 5,800 + 22% x (100,000 - 50,400)
    assert schedule_tax(Decimal(100_000), SINGLE) == Decimal(16_712)
    # 192,979.25 + 37% x (1,000,000 - 640,600)
    assert schedule_tax(Decimal(1_000_000), SINGLE) == Decimal("325957.25")
    # 35,932 + 24% x (250,000 - 211,400)
    assert schedule_tax(Decimal(250_000), MFJ) == Decimal(45_196)
    # 1,770 + 12% x (60,000 - 17,700)
    assert schedule_tax(Decimal(60_000), HOH) == Decimal(6_846)
    assert schedule_tax(Decimal(0), SINGLE) == 0
    assert schedule_tax(Decimal(-5), SINGLE) == 0


def test_bracket_rate_at_and_around_a_floor() -> None:
    assert bracket_rate(Decimal(50_399), SINGLE) == Decimal("0.12")
    assert bracket_rate(Decimal(50_400), SINGLE) == Decimal("0.22")
    assert bracket_rate(Decimal(50_401), SINGLE) == Decimal("0.22")
    assert bracket_rate(Decimal(0), SINGLE) == Decimal("0.10")
    assert bracket_rate(Decimal(10_000_000), SINGLE) == TOP_RATE


def test_tax_table_uses_the_row_midpoint() -> None:
    # Row 50,000-50,050 -> 50,025: 1,240 + 12% x 37,625 = 5,755
    assert tax_table_tax(Decimal(50_020), SINGLE) == 5_755
    assert tax_table_tax(Decimal(50_000), SINGLE) == 5_755
    assert tax_table_tax(Decimal("50049.99"), SINGLE) == 5_755
    # Row 99,950-100,000 -> 99,975: 5,800 + 22% x 49,575 = 16,706.50 -> 16,707
    assert tax_table_tax(Decimal(99_999), SINGLE) == 16_707
    # At the ceiling the rate schedule takes over.
    assert tax_table_tax(Decimal(100_000), SINGLE) == Decimal(16_712)
    assert tax_table_tax(Decimal(150_000), SINGLE) == schedule_tax(Decimal(150_000), SINGLE)


def test_tax_table_small_rows() -> None:
    assert tax_table_tax(Decimal(3), SINGLE) == 0
    assert tax_table_tax(Decimal(12), SINGLE) == 1  # row 5-15 -> 10
    assert tax_table_tax(Decimal(20), SINGLE) == 2  # row 15-25 -> 20
    assert tax_table_tax(Decimal(30), SINGLE) == 4  # row 25-50 -> 37.50 -> 3.75
    # Row 2,975-3,000 -> 2,987.50 -> 298.75
    assert tax_table_tax(Decimal(2_990), SINGLE) == 299
    # Row 3,000-3,050 -> 3,025 -> 302.50, half rounds up
    assert tax_table_tax(Decimal(3_010), SINGLE) == 303


@given(statuses, money())
def test_schedule_equals_base_plus_rate_on_excess(status: FilingStatus, income: Decimal) -> None:
    """The summed-bands form and the published base-amount form agree."""
    bands = TY2026.brackets[status]
    bases = base_amounts(bands)
    i = max(k for k, band in enumerate(bands) if income >= band.floor)
    published = bases[i] + (income - bands[i].floor) * bands[i].rate
    assert abs(schedule_tax(income, bands) - published) <= CENT / 2


@given(statuses, money(), money(50_000))
def test_schedule_is_monotone_and_never_steeper_than_the_top_rate(
    status: FilingStatus, income: Decimal, extra: Decimal
) -> None:
    bands = TY2026.brackets[status]
    low, high = schedule_tax(income, bands), schedule_tax(income + extra, bands)
    assert low <= high
    assert high - low <= extra * TOP_RATE + CENT


@given(statuses, money())
def test_slices_account_for_all_income(status: FilingStatus, income: Decimal) -> None:
    slices = slice_brackets(income, TY2026.brackets[status])
    assert sum(s.amount for s in slices) == income
    assert all(s.amount >= 0 for s in slices)
    assert all(s.ceiling is None or s.amount <= s.ceiling - s.floor for s in slices)


@given(statuses, money(99_999))
def test_tax_table_stays_within_one_row_of_the_schedule(
    status: FilingStatus, income: Decimal
) -> None:
    """A $50 row at 22% moves the tax by at most $5.50 either way, plus rounding."""
    bands = TY2026.brackets[status]
    assert abs(tax_table_tax(income, bands) - schedule_tax(income, bands)) <= Decimal("6.51")


@given(statuses, st.integers(min_value=0, max_value=99_999))
def test_tax_table_is_constant_within_a_row(status: FilingStatus, dollars: int) -> None:
    bands = TY2026.brackets[status]
    width = 25 if 25 <= dollars < 3_000 else 50
    if dollars < 25:
        return
    row_start = dollars // width * width
    assert tax_table_tax(Decimal(dollars), bands) == tax_table_tax(Decimal(row_start), bands)
