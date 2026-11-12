"""The full estimate. Expected values are worked by hand, line by line."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest
from hypothesis import given, settings

from taxline_quant import (
    TY2026,
    DeductionKind,
    FilingStatus,
    QbiRegime,
    ReturnInput,
    compute_return,
)
from taxline_quant.money import CENT

from .strategies import money, return_inputs

D = Decimal
SINGLE, MFJ = FilingStatus.SINGLE, FilingStatus.MFJ


def test_single_wage_earner() -> None:
    r = compute_return(ReturnInput(status=SINGLE, wages=D(85_000), federal_withholding=D(9_000)))
    assert r.agi == D(85_000)
    assert r.deduction_kind is DeductionKind.STANDARD
    assert r.taxable == D(68_900)
    # Row 68,900-68,950 -> 68,925: 5,800 + 22% x 18,525 = 9,875.50 -> 9,876
    assert r.income_tax == D(9_876)
    assert r.total_tax == D(9_876)
    assert r.balance == D(-876)
    assert r.bracket_rate == D("0.22")
    assert r.marginal_rate == D("0.22")
    assert r.effective_rate == D("0.1161882353")  # 9,876 / 85,000
    assert r.lines()[-1].label == "Amount owed"


def test_self_employed_single_filer() -> None:
    r = compute_return(ReturnInput(status=SINGLE, self_employment_profit=D(100_000)))
    assert r.se.total == D("14129.55")
    assert r.agi == D("92935.22")  # 100,000 - 7,064.78
    assert r.qbi.tentative == D("18587.04")  # 20% x 92,935.22
    assert r.qbi.deduction == D("15367.04")  # limited to 20% x 76,835.22
    assert r.qbi.regime is QbiRegime.BELOW_THRESHOLD
    assert r.taxable == D("61468.18")
    # Row 61,450-61,500 -> 61,475: 5,800 + 22% x 11,075 = 8,236.50 -> 8,237
    assert r.income_tax == D(8_237)
    assert r.total_tax == D("22366.55")
    # The next $100 of non-SE income adds $80 of taxable income (QBI limit grows by $20) at 22%.
    assert r.marginal_rate == D("0.176")


def test_joint_filers_with_a_side_business() -> None:
    r = compute_return(
        ReturnInput(
            status=MFJ,
            wages=D(142_000),
            self_employment_profit=D(38_000),
            federal_withholding=D(16_500),
        )
    )
    # NE 35,093: 4,351.53 + 1,017.70. The spouse's wages are not assumed to be the owner's.
    assert r.se.total == D("5369.23")
    assert r.se.deduction == D("2684.62")
    assert r.agi == D("177315.38")
    assert r.qbi.deduction == D("7063.08")  # 20% x (38,000 - 2,684.62)
    assert r.taxable == D("138052.30")
    # 11,600 + 22% x 37,252.30 = 19,795.506
    assert r.income_tax == D("19795.51")
    assert r.additional_medicare == 0
    assert r.total_tax == D("25164.74")
    assert r.balance == D("-8664.74")


def test_itemizing_beats_the_standard_deduction() -> None:
    r = compute_return(ReturnInput(status=SINGLE, wages=D(120_000), itemized=D(30_000)))
    assert r.deduction_kind is DeductionKind.ITEMIZED
    assert r.taxable == D(90_000)
    low = compute_return(ReturnInput(status=SINGLE, wages=D(120_000), itemized=D(9_000)))
    assert low.deduction == TY2026.standard_deduction[SINGLE]


def test_high_wages_pay_additional_medicare() -> None:
    r = compute_return(ReturnInput(status=SINGLE, wages=D(300_000), use_tax_table=False))
    assert r.additional_medicare == D(900)
    # 283,900 taxable: 58,448 + 35% x 27,675 = 68,134.25
    assert r.income_tax == D("68134.25")
    assert r.total_tax == D("69034.25")
    assert r.marginal_rate == D("0.35")


def test_a_business_loss_offsets_wages() -> None:
    r = compute_return(
        ReturnInput(status=SINGLE, wages=D(60_000), self_employment_profit=D(-10_000))
    )
    assert r.total_income == D(50_000)
    assert r.se.total == 0
    assert r.qbi.deduction == 0
    assert r.taxable == D(33_900)


def test_refund_when_payments_exceed_tax() -> None:
    r = compute_return(
        ReturnInput(
            status=SINGLE,
            wages=D(40_000),
            federal_withholding=D(2_000),
            estimated_payments=D(1_500),
        )
    )
    # Taxable 23,900 -> 23,925: 1,240 + 12% x 11,525 = 2,623
    assert r.income_tax == D(2_623)
    assert r.payments == D(3_500)
    assert r.balance == D(877)
    assert r.lines()[-1].label == "Refund"


def test_zero_income() -> None:
    r = compute_return(ReturnInput(status=SINGLE))
    assert r.total_tax == 0
    assert r.effective_rate == 0
    assert r.bracket_rate == D("0.10")


def test_negative_inputs_are_rejected() -> None:
    with pytest.raises(ValueError, match="wages cannot be negative"):
        ReturnInput(status=SINGLE, wages=D(-1))
    with pytest.raises(TypeError):
        ReturnInput(status=SINGLE, wages=85_000.0)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        ReturnInput(status="single")  # type: ignore[arg-type]


@given(return_inputs())
def test_return_invariants(inputs: ReturnInput) -> None:
    r = compute_return(inputs, with_marginal=False)
    assert r.total_tax >= 0
    assert 0 <= r.taxable <= r.agi
    assert r.total_tax == r.income_tax + r.se.total + r.additional_medicare
    assert r.balance == r.payments - r.total_tax
    assert r.deduction >= TY2026.standard_deduction[inputs.status]
    assert sum(s.amount for s in r.slices) == r.taxable
    assert r.income_tax <= r.taxable * D("0.37") + 1


@settings(max_examples=60)
@given(return_inputs(), money(20_000))
def test_more_wages_never_lower_total_tax(inputs: ReturnInput, extra: Decimal) -> None:
    exact = replace(inputs, use_tax_table=False)
    low = compute_return(exact, with_marginal=False)
    high = compute_return(replace(exact, wages=exact.wages + extra), with_marginal=False)
    assert low.total_tax <= high.total_tax + CENT


@settings(max_examples=60)
@given(return_inputs())
def test_marginal_rate_is_plausible(inputs: ReturnInput) -> None:
    r = compute_return(inputs)
    # The 37% bracket plus 0.9% Additional Medicare never applies to the bump (it is
    # not wages), but losing QBI deduction in the phase-in can push the rate above 37%.
    assert D(0) <= r.marginal_rate <= D("0.60")
