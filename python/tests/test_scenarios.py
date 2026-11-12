from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from itertools import pairwise

import pytest
from hypothesis import given, settings

from taxline_quant import FilingStatus, ReturnInput, compute_return
from taxline_quant.scenarios import (
    grid,
    kinks,
    marginal_rate_on,
    money_range,
    sensitivity,
    sweep,
    with_value,
)

from .strategies import money, return_inputs

D = Decimal
WAGE_EARNER = ReturnInput(status=FilingStatus.SINGLE, wages=D(85_000))
FREELANCER = ReturnInput(status=FilingStatus.SINGLE, self_employment_profit=D(100_000))


def test_money_range_is_inclusive() -> None:
    assert money_range(D(0), D(100), D(25)) == (D(0), D(25), D(50), D(75), D(100))
    assert money_range(D(5), D(5), D(1)) == (D(5),)
    with pytest.raises(ValueError, match="positive"):
        money_range(D(0), D(10), D(0))
    with pytest.raises(ValueError, match="below start"):
        money_range(D(10), D(0), D(1))


def test_marginal_rate_on_wages_is_the_bracket_rate() -> None:
    # Taxable 68,900 sits in the 22% band and nothing else interacts.
    assert marginal_rate_on(WAGE_EARNER, "wages") == D("0.22")


def test_marginal_rate_on_self_employment_profit_includes_se_tax() -> None:
    # +100 profit: NE +92.35 -> SE tax +14.13 (11.4514 + 2.67815, each rounded),
    # deduction +7.06 (14,143.68 / 2 = 7,071.84 vs 7,064.78).
    # AGI +92.94; QBI limit is 20% of taxable-before-QBI, so taxable +74.35 at 22% = 16.36.
    # Total: 14.13 + 16.36 = 30.49.
    assert marginal_rate_on(FREELANCER, "self_employment_profit") == D("0.3049")


def test_marginal_rate_on_a_deduction_is_negative() -> None:
    itemizer = replace(WAGE_EARNER, itemized=D(30_000))
    assert marginal_rate_on(itemizer, "itemized") == D("-0.22")
    # Below the standard deduction, another dollar of itemized deductions changes nothing.
    assert marginal_rate_on(replace(WAGE_EARNER, itemized=D(5_000)), "itemized") == 0


def test_sweep_matches_direct_computation() -> None:
    values = money_range(D(0), D(200_000), D(50_000))
    points = sweep(WAGE_EARNER, "wages", values)
    assert [p.x for p in points] == list(values)
    for p in points:
        direct = compute_return(replace(WAGE_EARNER, wages=p.x))
        assert p.total_tax == direct.total_tax
        assert p.effective_rate == direct.effective_rate
    assert points[0].total_tax == 0


def test_kinks_find_the_bracket_floors() -> None:
    # Wages from 60,000 to 130,000: taxable crosses 50,400 (wages 66,500) and
    # 105,700 (wages 121,800).
    points = sweep(WAGE_EARNER, "wages", money_range(D(60_000), D(130_000), D(100)))
    found = kinks(points)
    assert [(k.x, k.rate_before, k.rate_after) for k in found] == [
        (D(66_500), D("0.12"), D("0.22")),
        (D(121_800), D("0.22"), D("0.24")),
    ]


def test_grid_is_income_by_deduction() -> None:
    g = grid(
        WAGE_EARNER,
        "wages",
        [D(80_000), D(120_000)],
        "itemized",
        [D(0), D(30_000)],
    )
    assert g.rows == (D(80_000), D(120_000))
    assert len(g.total_tax) == 2
    assert len(g.total_tax[0]) == 2
    for i, wages in enumerate(g.rows):
        for j, itemized in enumerate(g.cols):
            direct = compute_return(replace(WAGE_EARNER, wages=wages, itemized=itemized))
            assert g.total_tax[i][j] == direct.total_tax
    with pytest.raises(ValueError, match="must differ"):
        grid(WAGE_EARNER, "wages", [D(1)], "wages", [D(1)])


def test_sensitivity_ranks_by_swing() -> None:
    base = ReturnInput(
        status=FilingStatus.SINGLE,
        wages=D(60_000),
        self_employment_profit=D(120_000),
        itemized=D(22_000),
    )
    result = sensitivity(base)
    assert [s.field for s in result] == ["self_employment_profit", "wages", "itemized"]
    assert result[0].swing >= result[1].swing >= result[2].swing
    by_field = {s.field: s for s in result}
    # Wages +/-6,000 in the 24% band.
    assert by_field["wages"].high_delta == D(1_440)
    assert by_field["wages"].low_delta == D(-1_440)
    # A larger deduction lowers tax.
    assert by_field["itemized"].high_delta < 0 < by_field["itemized"].low_delta
    assert by_field["itemized"].elasticity < 0


def test_sensitivity_rejects_bad_arguments() -> None:
    with pytest.raises(ValueError, match="between 0 and 1"):
        sensitivity(WAGE_EARNER, shock=D(2))
    with pytest.raises(ValueError, match="cannot vary"):
        sensitivity(WAGE_EARNER, fields=["status"])
    with pytest.raises(ValueError, match="cannot vary"):
        with_value(WAGE_EARNER, "sstb", D(1))


@settings(max_examples=40)
@given(return_inputs(), money(300_000))
def test_wage_sweep_is_monotone(inputs: ReturnInput, top: Decimal) -> None:
    exact = replace(inputs, use_tax_table=False)
    step = max(D(1), (top / 4).quantize(D(1)))
    points = sweep(exact, "wages", money_range(D(0), top, step))
    taxes = [p.total_tax for p in points]
    assert all(a <= b + D("0.01") for a, b in pairwise(taxes))
