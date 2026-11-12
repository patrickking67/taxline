"""Hypothesis strategies shared by the property tests."""

from __future__ import annotations

from decimal import Decimal

from hypothesis import strategies as st

from taxline_quant import FilingStatus, ReturnInput

statuses = st.sampled_from(list(FilingStatus))


def money(max_value: int = 2_000_000, min_value: int = 0) -> st.SearchStrategy[Decimal]:
    """Dollar amounts with cents."""
    return st.decimals(
        min_value=Decimal(min_value),
        max_value=Decimal(max_value),
        places=2,
        allow_nan=False,
        allow_infinity=False,
    )


@st.composite
def return_inputs(draw: st.DrawFn) -> ReturnInput:
    return ReturnInput(
        status=draw(statuses),
        wages=draw(money(800_000)),
        self_employment_profit=draw(money(900_000, min_value=-50_000)),
        other_income=draw(money(200_000)),
        adjustments=draw(money(50_000)),
        itemized=draw(money(120_000)),
        federal_withholding=draw(money(200_000)),
        estimated_payments=draw(money(100_000)),
        qbi_w2_wages=draw(money(300_000)),
        qbi_ubia=draw(money(1_000_000)),
        sstb=draw(st.booleans()),
        use_tax_table=draw(st.booleans()),
    )
