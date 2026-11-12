"""Offline evaluation of field extraction: synthetic documents rendered as
damaged text, the service's rules extractor run over them, and precision,
recall, and calibration scoring. A simulated extractor is kept for testing the
scoring itself and for showing what miscalibration costs."""

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
from .render import QUALITIES, RenderedDocument, ScanQuality, render_documents
from .rules import ExtractorUnavailableError, rules_available, run_rules_extractor

__all__ = [
    "CALIBRATED",
    "OVERCONFIDENT",
    "PROFILES",
    "QUALITIES",
    "REVIEW_THRESHOLD",
    "Calibration",
    "Counts",
    "Evaluation",
    "ExtractorProfile",
    "ExtractorUnavailableError",
    "FieldKind",
    "GateRow",
    "Prediction",
    "ReliabilityBin",
    "RenderedDocument",
    "ScanQuality",
    "SyntheticDocument",
    "TruthField",
    "calibration",
    "evaluate",
    "generate_documents",
    "normalize",
    "render_documents",
    "rules_available",
    "run_rules_extractor",
    "simulate_extraction",
]
