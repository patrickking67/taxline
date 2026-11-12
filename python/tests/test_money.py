from __future__ import annotations

from decimal import Decimal

import pytest
from hypothesis import given

from taxline_quant.money import CENT, non_negative, round_cents, round_dollars, to_decimal

from .strategies import money


def test_floats_are_rejected() -> None:
    with pytest.raises(TypeError, match="floats are rejected"):
        to_decimal(0.1)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        to_decimal(True)


def test_non_finite_values_are_rejected() -> None:
    with pytest.raises(ValueError, match="finite"):
        to_decimal(Decimal("NaN"))
    with pytest.raises(ValueError, match="finite"):
        to_decimal("Infinity")


def test_strings_and_ints_are_exact() -> None:
    assert to_decimal("0.10") + to_decimal("0.20") == Decimal("0.30")
    assert to_decimal(3) == Decimal(3)
    assert non_negative("-5") == 0


def test_half_cent_ties_round_up() -> None:
    # 43,230.95 x 0.9 = 38,907.855 exactly; a binary float holds 38,907.85499...
    assert round_cents(Decimal("43230.95") * Decimal("0.9")) == Decimal("38907.86")
    assert round_cents(Decimal("10.075")) == Decimal("10.08")
    assert round_cents(Decimal("10.0749")) == Decimal("10.07")
    assert round_dollars(Decimal("9875.50")) == Decimal(9876)
    assert round_dollars(Decimal("9875.49")) == Decimal(9875)


@given(money())
def test_rounding_a_cent_value_changes_nothing(value: Decimal) -> None:
    assert round_cents(value) == value


@given(money())
def test_rounding_moves_less_than_a_cent(value: Decimal) -> None:
    third = value / 3
    assert abs(round_cents(third) - third) <= CENT / 2
