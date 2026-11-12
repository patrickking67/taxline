"""Progressive rate schedules.

Tax on taxable income ``T`` under bands with floors ``f_i`` and rates ``r_i``::

    tax(T) = sum_i r_i * max(0, min(T, f_{i+1}) - f_i)

Rev. Proc. 2025-32 prints the same schedule as "base amount plus rate on the
excess". ``base_amounts`` rebuilds those base amounts from the floors and rates,
and the tests compare them with the figures printed in the revenue procedure.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from itertools import pairwise

from .constants import TY2026, Bracket, TaxTableParams
from .money import ZERO, mul, round_cents, round_dollars


@dataclass(frozen=True, slots=True)
class BracketSlice:
    rate: Decimal
    floor: Decimal
    ceiling: Decimal | None
    """Upper edge of the band, or ``None`` for the top band."""
    amount: Decimal
    """Taxable income that falls inside this band."""
    tax: Decimal
    """Unrounded tax on ``amount``."""


def slice_brackets(taxable: Decimal, brackets: Sequence[Bracket]) -> tuple[BracketSlice, ...]:
    """Split taxable income across the bands. Empty bands are returned too."""
    t = max(ZERO, taxable)
    slices: list[BracketSlice] = []
    for i, band in enumerate(brackets):
        ceiling = brackets[i + 1].floor if i + 1 < len(brackets) else None
        top = t if ceiling is None else min(t, ceiling)
        amount = max(ZERO, top - band.floor)
        slices.append(BracketSlice(band.rate, band.floor, ceiling, amount, mul(amount, band.rate)))
    return tuple(slices)


def schedule_tax(taxable: Decimal, brackets: Sequence[Bracket]) -> Decimal:
    """Exact rate-schedule tax, rounded to the cent."""
    return round_cents(sum((s.tax for s in slice_brackets(taxable, brackets)), ZERO))


def base_amounts(brackets: Sequence[Bracket]) -> tuple[Decimal, ...]:
    """Tax at each band floor: the "base amount" column of the published tables."""
    bases = [ZERO]
    for prev, cur in pairwise(brackets):
        bases.append(round_cents(bases[-1] + mul(cur.floor - prev.floor, prev.rate)))
    return tuple(bases)


def bracket_rate(taxable: Decimal, brackets: Sequence[Bracket]) -> Decimal:
    """Statutory rate on the next dollar of taxable income.

    Income above a floor is taxed at that band's rate, so at exactly the floor
    the next dollar already falls in the higher band.
    """
    rate = brackets[0].rate
    for band in brackets:
        if taxable >= band.floor:
            rate = band.rate
    return rate


def tax_table_tax(
    taxable: Decimal,
    brackets: Sequence[Bracket],
    table: TaxTableParams = TY2026.tax_table,
) -> Decimal:
    """Tax Table lookup from the Form 1040 instructions.

    Below the table ceiling the IRS taxes the midpoint of the row that contains
    the taxable income and rounds to whole dollars. The first three rows are
    irregular ($0-5, $5-15, $15-25); after that rows are $25 wide up to $3,000
    and $50 wide up to $100,000. At or above the ceiling the rate schedule
    applies unchanged.
    """
    t = max(ZERO, taxable)
    if t >= table.ceiling:
        return schedule_tax(t, brackets)
    if t < 5:
        return ZERO
    if t < 15:
        midpoint = Decimal(10)
    elif t < 25:
        midpoint = Decimal(20)
    else:
        width = table.small_row_width if t < table.small_row_ceiling else table.row_width
        midpoint = (t // width) * width + width / 2
    return round_dollars(schedule_tax(midpoint, brackets))
