"""What-if analysis over the model: sweeps, grids, and one-at-a-time sensitivity.

Everything here re-runs ``compute_return`` on changed inputs; nothing is
interpolated. Marginal rates are finite differences on the exact rate schedule,
so they include every interaction the model has: self-employment tax and its
deduction, the QBI income limit and phase-in, and the Additional Medicare Tax.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from itertools import pairwise
from typing import Any, Final

from .constants import TY2026, TaxYear
from .model import ReturnInput, ReturnResult, compute_return
from .money import ZERO, mul, ratio, round_cents

MARGINAL_STEP: Final = Decimal(100)

# Inputs a sweep may vary. Flags and the filing status are not continuous.
SWEEPABLE: Final = frozenset(
    {
        "wages",
        "self_employment_profit",
        "other_income",
        "adjustments",
        "itemized",
        "federal_withholding",
        "estimated_payments",
        "qbi_w2_wages",
        "qbi_ubia",
    }
)


@dataclass(frozen=True, slots=True)
class SweepPoint:
    x: Decimal
    """The value the swept input took."""
    total_income: Decimal
    taxable: Decimal
    income_tax: Decimal
    se_tax: Decimal
    additional_medicare: Decimal
    qbi_deduction: Decimal
    total_tax: Decimal
    effective_rate: Decimal
    bracket_rate: Decimal
    marginal_rate: Decimal
    """Change in total tax per extra dollar of the swept input, over the next $100."""

    @classmethod
    def of(cls, x: Decimal, r: ReturnResult, marginal_rate: Decimal) -> SweepPoint:
        return cls(
            x=x,
            total_income=r.total_income,
            taxable=r.taxable,
            income_tax=r.income_tax,
            se_tax=r.se.total,
            additional_medicare=r.additional_medicare,
            qbi_deduction=r.qbi.deduction,
            total_tax=r.total_tax,
            effective_rate=r.effective_rate,
            bracket_rate=r.bracket_rate,
            marginal_rate=marginal_rate,
        )


def money_range(start: Decimal, stop: Decimal, step: Decimal) -> tuple[Decimal, ...]:
    """Inclusive range of amounts: ``start, start + step, ...`` up to ``stop``."""
    if step <= 0:
        raise ValueError("step must be positive")
    if stop < start:
        raise ValueError("stop must not be below start")

    def values() -> Iterator[Decimal]:
        x = start
        while x <= stop:
            yield x
            x += step

    return tuple(values())


def with_value(base: ReturnInput, field: str, value: Decimal) -> ReturnInput:
    if field not in SWEEPABLE:
        raise ValueError(f"cannot vary {field!r}; choose one of {sorted(SWEEPABLE)}")
    changes: dict[str, Any] = {field: value}
    return replace(base, **changes)


def marginal_rate_on(
    base: ReturnInput,
    field: str,
    year: TaxYear = TY2026,
    step: Decimal = MARGINAL_STEP,
) -> Decimal:
    """Change in total tax per extra dollar of one input.

    A finite difference over ``step`` dollars on the exact rate schedule, so
    Tax Table rows do not distort it. For self-employment profit this includes
    the self-employment tax; for a deduction it is negative.
    """
    exact = replace(base, use_tax_table=False)
    here = compute_return(exact, year, with_marginal=False).total_tax
    value: Decimal = getattr(exact, field)
    there = compute_return(
        with_value(exact, field, value + step), year, with_marginal=False
    ).total_tax
    return ratio(there - here, step)


def sweep(
    base: ReturnInput,
    field: str,
    values: Sequence[Decimal],
    year: TaxYear = TY2026,
) -> tuple[SweepPoint, ...]:
    """Recompute the return at each value of one input, everything else fixed."""
    points: list[SweepPoint] = []
    for x in values:
        inputs = with_value(base, field, x)
        result = compute_return(inputs, year, with_marginal=False)
        points.append(SweepPoint.of(x, result, marginal_rate_on(inputs, field, year)))
    return tuple(points)


@dataclass(frozen=True, slots=True)
class Grid:
    """Total tax over two inputs. ``total_tax[i][j]`` is at ``rows[i]``, ``cols[j]``."""

    row_field: str
    col_field: str
    rows: tuple[Decimal, ...]
    cols: tuple[Decimal, ...]
    total_tax: tuple[tuple[Decimal, ...], ...]


def grid(
    base: ReturnInput,
    row_field: str,
    rows: Sequence[Decimal],
    col_field: str,
    cols: Sequence[Decimal],
    *,
    year: TaxYear = TY2026,
) -> Grid:
    """Total tax over a grid of two inputs, such as income by deduction."""
    if row_field == col_field:
        raise ValueError("row and column inputs must differ")
    table = tuple(
        tuple(
            compute_return(
                with_value(with_value(base, row_field, r), col_field, c),
                year,
                with_marginal=False,
            ).total_tax
            for c in cols
        )
        for r in rows
    )
    return Grid(row_field, col_field, tuple(rows), tuple(cols), table)


@dataclass(frozen=True, slots=True)
class Kink:
    """A point on a sweep where the marginal rate changes."""

    x: Decimal
    rate_before: Decimal
    rate_after: Decimal


def kinks(points: Sequence[SweepPoint]) -> tuple[Kink, ...]:
    """Where the marginal rate steps along a sweep (at the sweep's resolution)."""
    return tuple(
        Kink(cur.x, prev.marginal_rate, cur.marginal_rate)
        for prev, cur in pairwise(points)
        if cur.marginal_rate != prev.marginal_rate
    )


@dataclass(frozen=True, slots=True)
class Sensitivity:
    """Change in total tax when one input moves down and up by a fraction."""

    field: str
    base_value: Decimal
    low_delta: Decimal
    high_delta: Decimal
    elasticity: Decimal
    """Percent change in total tax per percent change in the input, from the up move."""

    @property
    def swing(self) -> Decimal:
        return abs(self.high_delta - self.low_delta)


def sensitivity(
    base: ReturnInput,
    shock: Decimal = Decimal("0.10"),
    fields: Sequence[str] | None = None,
    year: TaxYear = TY2026,
) -> tuple[Sensitivity, ...]:
    """One-at-a-time sensitivity of total tax, largest swing first.

    Each non-zero input in ``fields`` is moved by ``-shock`` and ``+shock`` of
    its own value with the others held fixed. Inputs at zero are skipped: a
    percentage of nothing says nothing.
    """
    if not ZERO < shock < 1:
        raise ValueError("shock must be between 0 and 1")
    chosen = sorted(SWEEPABLE - {"federal_withholding", "estimated_payments"})
    if fields is not None:
        chosen = list(fields)
    base_tax = compute_return(base, year, with_marginal=False).total_tax
    out: list[Sensitivity] = []
    for name in chosen:
        value: Decimal = getattr(base, name)
        if name not in SWEEPABLE:
            raise ValueError(f"cannot vary {name!r}")
        if value == 0:
            continue
        low = round_cents(mul(value, 1 - shock))
        high = round_cents(mul(value, 1 + shock))
        low_tax = compute_return(with_value(base, name, low), year, with_marginal=False).total_tax
        high_tax = compute_return(with_value(base, name, high), year, with_marginal=False).total_tax
        elasticity = ratio(ratio(high_tax - base_tax, base_tax), shock) if base_tax > 0 else ZERO
        out.append(Sensitivity(name, value, low_tax - base_tax, high_tax - base_tax, elasticity))
    return tuple(sorted(out, key=lambda s: s.swing, reverse=True))
