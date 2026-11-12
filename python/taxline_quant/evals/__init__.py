"""Offline evaluation of field extraction: synthetic documents, a simulated
extractor, and precision, recall, and calibration scoring."""

from __future__ import annotations

from .documents import FieldKind, SyntheticDocument, TruthField, generate_documents
from .extractor import (
    CALIBRATED,
    OVERCONFIDENT,
    PROFILES,
    ExtractorProfile,
    Prediction,
    simulate_extraction,
)
from .metrics import (
    REVIEW_THRESHOLD,
    Calibration,
    Counts,
    Evaluation,
    GateRow,
    ReliabilityBin,
    calibration,
    evaluate,
    normalize,
)

__all__ = [
    "CALIBRATED",
    "OVERCONFIDENT",
    "PROFILES",
    "REVIEW_THRESHOLD",
    "Calibration",
    "Counts",
    "Evaluation",
    "ExtractorProfile",
    "FieldKind",
    "GateRow",
    "Prediction",
    "ReliabilityBin",
    "SyntheticDocument",
    "TruthField",
    "calibration",
    "evaluate",
    "generate_documents",
    "normalize",
    "simulate_extraction",
]
