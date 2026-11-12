"""Monte Carlo projection of estimated tax payments when income is uncertain.

The question: a self-employed filer plans four equal estimated payments at the
start of the year from an income forecast. If profit turns out different, how
often does the plan fall short of the required annual payment, and by how much?

Method. Annual net profit is ``forecast * M`` where ``M`` is lognormal with mean
1 and a chosen coefficient of variation. For each draw the full model is re-run
on ``Decimal`` to get that year's actual tax, and from it the required annual
payment under IRC sec. 6654(d): the smaller of 90% of the actual tax and the
prior-year safe harbor, less withholding. Two fixed plans are scored against it.

Draws come from ``numpy.random.Generator(PCG64(seed))``. Each standard normal
is rounded to nine decimals and exponentiated with ``Decimal.exp``, which is
correctly rounded, so a seed gives the same dollars on every platform.

The assumptions are returned with every result; see ``Projection.assumptions``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import ROUND_CEILING, Decimal
from typing import Final

import numpy as np

from .constants import TY2026, TaxYear
from .estimated import estimated_tax
from .model import ReturnInput, compute_return
from .money import ZERO, div, mul, ratio, round_cents

PERCENTILES: Final = (5, 25, 50, 75, 95)
_Z_QUANTUM: Final = Decimal("1e-9")
_MAX_DRAWS: Final = 1_000_000


@dataclass(frozen=True, slots=True)
class Distribution:
    """Summary of one simulated quantity. Percentiles are nearest-rank, so every
    figure is a value that was actually simulated."""

    mean: Decimal
    stdev: Decimal
    minimum: Decimal
    maximum: Decimal
    percentiles: tuple[tuple[int, Decimal], ...]

    def percentile(self, p: int) -> Decimal:
        return dict(self.percentiles)[p]


@dataclass(frozen=True, slots=True)
class PlanOutcome:
    """How one fixed payment plan fares across the draws."""

    name: str
    description: str
    annual_payment: Decimal
    quarterly_payment: Decimal
    shortfall_probability: Decimal
    """Share of draws where the plan pays less than the required annual payment."""
    shortfall_standard_error: Decimal
    shortfall_when_short: Distribution | None
    """Required payment less the plan, over the draws that fall short."""
    balance_at_filing: Distribution
    """Actual tax less withholding and the plan. Negative is a refund."""


@dataclass(frozen=True, slots=True)
class Projection:
    seed: int
    draws: int
    forecast_profit: Decimal
    cv: Decimal
    profit: Distribution
    total_tax: Distribution
    required_annual_payment: Distribution
    required_quarterly_payment: Distribution
    plans: tuple[PlanOutcome, ...]
    assumptions: tuple[str, ...]
    samples_profit: tuple[Decimal, ...]
    samples_total_tax: tuple[Decimal, ...]
    samples_required: tuple[Decimal, ...]


def lognormal_multipliers(cv: Decimal, draws: int, seed: int) -> tuple[Decimal, ...]:
    """``draws`` multipliers with mean 1 and coefficient of variation ``cv``.

    For a lognormal, ``sigma^2 = ln(1 + cv^2)`` and ``mu = -sigma^2 / 2`` gives
    a mean of exactly 1.
    """
    if cv < 0:
        raise ValueError("cv cannot be negative")
    if not 0 < draws <= _MAX_DRAWS:
        raise ValueError(f"draws must be between 1 and {_MAX_DRAWS}")
    if cv == 0:
        return (Decimal(1),) * draws
    sigma_squared = (1 + cv * cv).ln()
    sigma = sigma_squared.sqrt()
    mu = -sigma_squared / 2
    normals = np.random.Generator(np.random.PCG64(seed)).standard_normal(draws)
    return tuple((mu + sigma * Decimal(repr(float(z))).quantize(_Z_QUANTUM)).exp() for z in normals)


def _nearest_rank(ordered: Sequence[Decimal], p: int) -> Decimal:
    rank = (Decimal(p) * len(ordered) / 100).to_integral_value(rounding=ROUND_CEILING)
    return ordered[max(1, int(rank)) - 1]


def summarize(values: Sequence[Decimal]) -> Distribution:
    if not values:
        raise ValueError("cannot summarize an empty sample")
    ordered = sorted(values)
    n = len(ordered)
    mean = div(sum(ordered, ZERO), Decimal(n))
    variance = div(sum(((v - mean) ** 2 for v in ordered), ZERO), Decimal(n - 1)) if n > 1 else ZERO
    return Distribution(
        mean=round_cents(mean),
        stdev=round_cents(variance.sqrt()),
        minimum=ordered[0],
        maximum=ordered[-1],
        percentiles=tuple((p, _nearest_rank(ordered, p)) for p in PERCENTILES),
    )


def _score_plan(
    name: str,
    description: str,
    annual_payment: Decimal,
    required: Sequence[Decimal],
    tax_after_withholding: Sequence[Decimal],
) -> PlanOutcome:
    n = Decimal(len(required))
    shortfalls = [r - annual_payment for r in required if r > annual_payment]
    p = div(Decimal(len(shortfalls)), n)
    per = round_cents(annual_payment / 4)
    return PlanOutcome(
        name=name,
        description=description,
        annual_payment=annual_payment,
        quarterly_payment=per,
        shortfall_probability=ratio(Decimal(len(shortfalls)), n),
        shortfall_standard_error=ratio(mul(p, 1 - p).sqrt(), n.sqrt()),
        shortfall_when_short=summarize(shortfalls) if shortfalls else None,
        balance_at_filing=summarize([t - annual_payment for t in tax_after_withholding]),
    )


def simulate(
    base: ReturnInput,
    *,
    cv: Decimal,
    draws: int = 10_000,
    seed: int = 20_260_415,
    prior_year_tax: Decimal | None = None,
    prior_year_agi: Decimal | None = None,
    year: TaxYear = TY2026,
) -> Projection:
    """Project the required estimated payments for ``base`` under profit uncertainty.

    ``base.self_employment_profit`` is the forecast (the mean of the simulated
    profit) and must be positive. Everything else in ``base`` is held fixed.
    """
    forecast = base.self_employment_profit
    if forecast <= 0:
        raise ValueError("the forecast self-employment profit must be positive")
    withholding = base.federal_withholding
    status = base.status

    profits = tuple(round_cents(mul(forecast, m)) for m in lognormal_multipliers(cv, draws, seed))
    taxes = tuple(
        compute_return(
            replace(base, self_employment_profit=profit), year, with_marginal=False
        ).total_tax
        for profit in profits
    )
    required = tuple(
        estimated_tax(
            status,
            tax,
            withholding,
            prior_year_tax=prior_year_tax,
            prior_year_agi=prior_year_agi,
            year=year,
        ).due_from_estimates
        for tax in taxes
    )
    after_withholding = [tax - withholding for tax in taxes]

    forecast_tax = compute_return(base, year, with_marginal=False).total_tax
    forecast_plan = estimated_tax(status, forecast_tax, withholding, year=year)
    plans = [
        _score_plan(
            "forecast-90",
            "Pay 90% of the tax on the forecast profit, less withholding, in four installments.",
            forecast_plan.due_from_estimates,
            required,
            after_withholding,
        )
    ]
    if prior_year_tax is not None:
        prior_plan = estimated_tax(
            status,
            # A very large current-year tax makes the prior-year test the binding one.
            max(forecast_tax, prior_year_tax * 2) + year.estimated.minimum_balance_due,
            withholding,
            prior_year_tax=prior_year_tax,
            prior_year_agi=prior_year_agi,
            year=year,
        )
        plans.append(
            _score_plan(
                "prior-year",
                "Pay the prior-year safe harbor (100% or 110% of last year's tax), less "
                "withholding, in four installments.",
                prior_plan.due_from_estimates,
                required,
                after_withholding,
            )
        )

    prior_note = (
        "The prior-year safe harbor is not available: no prior-year tax was given, so the "
        "required payment is 90% of the simulated year's tax."
        if prior_year_tax is None
        else f"Prior-year tax is ${prior_year_tax:,.2f} on a full 12-month return."
    )
    assumptions = (
        f"Tax year {year.year} federal rules as modeled in taxline_quant; no state tax, "
        "credits, capital gains, or AMT.",
        f"Annual net profit is lognormal with mean ${forecast:,.2f} and coefficient of "
        f"variation {cv}. Real income is not lognormal; this is a stand-in for uncertainty.",
        "Only self-employment profit varies. Wages, deductions, and withholding are fixed.",
        "Installments are four equal payments under the regular method "
        "(IRC sec. 6654(d)(1)(A)); the annualized income method is not modeled.",
        "A shortfall means the plan paid less than the required annual payment. The "
        "underpayment penalty itself (IRC sec. 6654(a)) is not computed because it depends "
        "on quarterly interest rates and payment dates.",
        prior_note,
        f"{draws:,} draws from numpy PCG64 with seed {seed}; percentiles are nearest-rank.",
    )
    return Projection(
        seed=seed,
        draws=draws,
        forecast_profit=forecast,
        cv=cv,
        profit=summarize(profits),
        total_tax=summarize(taxes),
        required_annual_payment=summarize(required),
        required_quarterly_payment=summarize([round_cents(r / 4) for r in required]),
        plans=tuple(plans),
        assumptions=assumptions,
        samples_profit=profits,
        samples_total_tax=taxes,
        samples_required=required,
    )
