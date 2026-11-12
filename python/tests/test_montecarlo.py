from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from taxline_quant import FilingStatus, ReturnInput, compute_return
from taxline_quant.montecarlo import (
    PERCENTILES,
    lognormal_multipliers,
    simulate,
    summarize,
)

from .strategies import money

D = Decimal
FREELANCER = ReturnInput(status=FilingStatus.SINGLE, self_employment_profit=D(120_000))
DRAWS = 2_000


def test_nearest_rank_percentiles_by_hand() -> None:
    # 1..20: the 5th percentile is the 1st value, the 50th the 10th, the 95th the 19th.
    dist = summarize([D(n) for n in range(20, 0, -1)])
    assert dist.percentile(5) == 1
    assert dist.percentile(25) == 5
    assert dist.percentile(50) == 10
    assert dist.percentile(75) == 15
    assert dist.percentile(95) == 19
    assert dist.mean == D("10.50")
    assert dist.stdev == D("5.92")  # sqrt(35)
    assert (dist.minimum, dist.maximum) == (D(1), D(20))


def test_summarize_rejects_an_empty_sample() -> None:
    with pytest.raises(ValueError, match="empty"):
        summarize([])


def test_multipliers_have_mean_one_and_the_requested_spread() -> None:
    cv = D("0.35")
    m = lognormal_multipliers(cv, 20_000, seed=11)
    dist = summarize(m)
    mean = sum(m, D(0)) / len(m)
    # Standard error of the mean is cv / sqrt(n) = 0.0025; allow four of them.
    assert abs(mean - 1) < D("0.01")
    assert abs(dist.stdev - cv) < D("0.02")
    assert all(x > 0 for x in m)


def test_zero_cv_is_deterministic() -> None:
    assert lognormal_multipliers(D(0), 5, seed=1) == (D(1),) * 5
    p = simulate(FREELANCER, cv=D(0), draws=50)
    expected = compute_return(FREELANCER).total_tax
    assert p.total_tax.minimum == p.total_tax.maximum == expected
    plan = p.plans[0]
    assert plan.shortfall_probability == 0
    assert plan.shortfall_when_short is None
    # Paying 90% leaves the other 10% due at filing.
    assert plan.balance_at_filing.mean == expected - plan.annual_payment


def test_same_seed_same_result() -> None:
    a = simulate(FREELANCER, cv=D("0.35"), draws=DRAWS, seed=7)
    b = simulate(FREELANCER, cv=D("0.35"), draws=DRAWS, seed=7)
    c = simulate(FREELANCER, cv=D("0.35"), draws=DRAWS, seed=8)
    assert a == b
    assert a.samples_profit != c.samples_profit
    assert a.total_tax != c.total_tax


def test_each_draw_is_the_exact_model() -> None:
    p = simulate(FREELANCER, cv=D("0.35"), draws=200, seed=3)
    for profit, tax in zip(p.samples_profit[:25], p.samples_total_tax[:25], strict=True):
        assert tax == compute_return(replace(FREELANCER, self_employment_profit=profit)).total_tax
        assert profit == profit.quantize(D("0.01"))


def test_forecast_plan_without_a_prior_year_falls_short_about_half_the_time() -> None:
    p = simulate(FREELANCER, cv=D("0.35"), draws=DRAWS, seed=7)
    plan = p.plans[0]
    assert plan.name == "forecast-90"
    assert len(p.plans) == 1
    # The plan covers 90% of the tax at the forecast; it is short whenever 90% of
    # the actual tax is higher, which is whenever profit beats the forecast.
    above = sum(1 for x in p.samples_profit if x > p.forecast_profit)
    assert plan.shortfall_probability == D(above) / D(DRAWS)
    assert D("0.35") < plan.shortfall_probability < D("0.50")
    assert plan.shortfall_when_short is not None
    assert plan.shortfall_when_short.minimum > 0
    assert 0 < plan.shortfall_standard_error < D("0.02")
    assert plan.quarterly_payment == (plan.annual_payment / 4).quantize(D("0.01"))


def test_prior_year_plan_never_falls_short() -> None:
    p = simulate(
        FREELANCER,
        cv=D("0.35"),
        draws=DRAWS,
        seed=7,
        prior_year_tax=D(24_000),
        prior_year_agi=D(110_000),
    )
    prior = next(plan for plan in p.plans if plan.name == "prior-year")
    assert prior.annual_payment == D(24_000)
    assert prior.shortfall_probability == 0
    # The required payment is capped at the prior-year amount in every draw.
    assert p.required_annual_payment.maximum == D(24_000)
    # The safe harbor removes the penalty exposure, not the balance due.
    assert prior.balance_at_filing.percentile(95) > 0


def test_high_prior_year_agi_plan_pays_110_percent() -> None:
    p = simulate(
        FREELANCER,
        cv=D("0.2"),
        draws=200,
        prior_year_tax=D(24_000),
        prior_year_agi=D(180_000),
    )
    prior = next(plan for plan in p.plans if plan.name == "prior-year")
    assert prior.annual_payment == D(26_400)


def test_percentiles_are_ordered_and_assumptions_stated() -> None:
    p = simulate(FREELANCER, cv=D("0.35"), draws=DRAWS, seed=7)
    for dist in (p.profit, p.total_tax, p.required_annual_payment, p.required_quarterly_payment):
        values = [dist.percentile(q) for q in PERCENTILES]
        assert values == sorted(values)
        assert dist.minimum <= values[0]
        assert values[-1] <= dist.maximum
    text = " ".join(p.assumptions)
    assert "lognormal" in text
    assert "seed 7" in text
    assert "penalty" in text
    assert "not available" in text


def test_invalid_arguments() -> None:
    with pytest.raises(ValueError, match="positive"):
        simulate(ReturnInput(status=FilingStatus.SINGLE, wages=D(50_000)), cv=D("0.3"))
    with pytest.raises(ValueError, match="cv"):
        lognormal_multipliers(D("-0.1"), 10, seed=1)
    with pytest.raises(ValueError, match="draws"):
        lognormal_multipliers(D("0.1"), 0, seed=1)


@given(st.lists(money(), min_size=1, max_size=60))
def test_summary_is_bounded_by_the_sample(values: list[Decimal]) -> None:
    dist = summarize(values)
    assert dist.minimum == min(values)
    assert dist.maximum == max(values)
    assert dist.minimum <= dist.mean <= dist.maximum
    assert all(p in values for _, p in dist.percentiles)
    assert dist.stdev >= 0
