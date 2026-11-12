"""Exact money arithmetic.

Every dollar amount in this package is a ``decimal.Decimal``. Binary floats are
rejected at the boundary because they cannot represent most cent values, and a
half-cent tie that drifts by one ulp changes a published line by a cent.

Rounding policy, shared with the TypeScript engine: a value is rounded half up
(away from zero for the non-negative amounts used here) to the cent at each
published line, the way a preparer carries a figure from one form line to the next.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, localcontext

type Money = Decimal

ZERO = Decimal(0)
CENT = Decimal("0.01")
DOLLAR = Decimal(1)
RATE_QUANTUM = Decimal("1e-10")

# Enough digits that a product or quotient of two money-sized operands is exact
# or far below the half-cent that decides a rounding.
_PRECISION = 50


def to_decimal(value: Decimal | int | str) -> Decimal:
    """Coerce an input to a finite ``Decimal``.

    Floats raise ``TypeError`` on purpose: ``Decimal(0.1)`` is not ``0.1``.
    """
    if isinstance(value, bool) or not isinstance(value, Decimal | int | str):
        raise TypeError(
            f"money must be Decimal, int, or str, not {type(value).__name__}; "
            "floats are rejected because they are not exact"
        )
    result = value if isinstance(value, Decimal) else Decimal(value)
    if not result.is_finite():
        raise ValueError(f"money must be finite, got {value!r}")
    return result


def non_negative(value: Decimal | int | str) -> Decimal:
    """Coerce to ``Decimal`` and floor at zero, for inputs that cannot be negative."""
    return max(ZERO, to_decimal(value))


def round_cents(value: Decimal) -> Decimal:
    """Round half up to the cent."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def round_dollars(value: Decimal) -> Decimal:
    """Round half up to the whole dollar, as the IRS permits on a return."""
    return value.quantize(DOLLAR, rounding=ROUND_HALF_UP)


def mul(a: Decimal, b: Decimal) -> Decimal:
    """Exact product at working precision."""
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return a * b


def div(a: Decimal, b: Decimal) -> Decimal:
    """Quotient at working precision."""
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return a / b


def ratio(a: Decimal, b: Decimal) -> Decimal:
    """A rate ``a / b`` carried to ten decimal places."""
    q = div(a, b).quantize(RATE_QUANTUM, rounding=ROUND_HALF_UP)
    return q if q != 0 else ZERO


def clamp(value: Decimal, low: Decimal, high: Decimal) -> Decimal:
    return min(high, max(low, value))
