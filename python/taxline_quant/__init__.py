"""taxline_quant: a typed TY2026 federal income tax model and the analysis around it.

Educational software on synthetic data. Nothing here is tax advice.
"""

from __future__ import annotations

from .brackets import base_amounts, bracket_rate, schedule_tax, slice_brackets, tax_table_tax
from .constants import TY2026, Bracket, FilingStatus, TaxYear, constant_table
from .estimated import EstimatedTax, SafeHarborBasis, estimated_tax
from .model import DeductionKind, ReturnInput, ReturnResult, compute_return
from .qbi import QbiDeduction, QbiRegime, qbi_deduction
from .self_employment import SelfEmploymentTax, additional_medicare_tax, self_employment_tax

__version__ = "0.1.0"

DISCLAIMER = (
    "Educational model on synthetic data for tax year 2026. Not tax, legal, or "
    "accounting advice. Do not file or pay based on this output."
)

__all__ = [
    "DISCLAIMER",
    "TY2026",
    "Bracket",
    "DeductionKind",
    "EstimatedTax",
    "FilingStatus",
    "QbiDeduction",
    "QbiRegime",
    "ReturnInput",
    "ReturnResult",
    "SafeHarborBasis",
    "SelfEmploymentTax",
    "TaxYear",
    "__version__",
    "additional_medicare_tax",
    "base_amounts",
    "bracket_rate",
    "compute_return",
    "constant_table",
    "estimated_tax",
    "qbi_deduction",
    "schedule_tax",
    "self_employment_tax",
    "slice_brackets",
    "tax_table_tax",
]
