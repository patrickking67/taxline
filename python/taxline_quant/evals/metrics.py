"""Field-level scoring of an extraction run against ground truth.

Definitions, per (document, field label):

- true positive: a value was extracted and equals the truth after normalization;
- false positive: a value was extracted and is wrong, or the document has no
  such field (a hallucinated field);
- false negative: the truth has the field and it was not extracted correctly
  (missing, declined, or wrong). A wrong value is both a false positive and a
  false negative, the usual convention for extraction.

Calibration covers predictions that carry a value and a confidence. Expected
calibration error is the count-weighted mean gap between a bin's mean
confidence and its accuracy, over equal-width confidence bins.

The gate rows apply the service's rule (``service/src/tools/confidence.ts``): a
field goes to a person when it has no value, no usable confidence, or a
confidence below the threshold.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final

from .documents import FieldKind, SyntheticDocument
from .extractor import Prediction

REVIEW_THRESHOLD: Final = 0.85
"""The service's CONFIDENCE_THRESHOLD."""
DEFAULT_BINS: Final = 10
DEFAULT_THRESHOLDS: Final = (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99)


def normalize(kind: FieldKind, value: str) -> str:
    """Canonical form for comparison: money by amount, IDs by digits, text by case."""
    text = value.strip()
    if kind is FieldKind.MONEY:
        try:
            return str(Decimal(text.replace("$", "").replace(",", "")).quantize(Decimal("0.01")))
        except InvalidOperation:
            return text
    if kind is FieldKind.ID:
        return "".join(ch for ch in text if ch.isdigit())
    return " ".join(text.casefold().split())


def valid_confidence(confidence: float | None) -> float | None:
    """A finite number in [0, 1], or ``None``: the service's ``validConfidence``."""
    if confidence is None or isinstance(confidence, bool):
        return None
    if not math.isfinite(confidence) or not 0 <= confidence <= 1:
        return None
    return float(confidence)


@dataclass(frozen=True, slots=True)
class Counts:
    true_positive: int
    false_positive: int
    false_negative: int

    @property
    def precision(self) -> float:
        extracted = self.true_positive + self.false_positive
        return self.true_positive / extracted if extracted else 0.0

    @property
    def recall(self) -> float:
        expected = self.true_positive + self.false_negative
        return self.true_positive / expected if expected else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0


@dataclass(frozen=True, slots=True)
class ReliabilityBin:
    lower: float
    upper: float
    count: int
    mean_confidence: float
    accuracy: float

    @property
    def gap(self) -> float:
        return abs(self.accuracy - self.mean_confidence)


@dataclass(frozen=True, slots=True)
class Calibration:
    scored: int
    bins: tuple[ReliabilityBin, ...]
    expected_calibration_error: float
    max_calibration_error: float
    brier_score: float
    mean_confidence: float
    accuracy: float


@dataclass(frozen=True, slots=True)
class GateRow:
    threshold: float
    auto_accepted: int
    sent_to_review: int
    escaped_errors: int
    """Wrong values that cleared the threshold."""
    errors_caught: int
    """Wrong values that were sent to review."""

    @property
    def review_rate(self) -> float:
        total = self.auto_accepted + self.sent_to_review
        return self.sent_to_review / total if total else 0.0

    @property
    def escape_rate(self) -> float:
        """Share of auto-accepted fields that are wrong."""
        return self.escaped_errors / self.auto_accepted if self.auto_accepted else 0.0

    @property
    def catch_rate(self) -> float:
        """Share of all wrong values that review would see."""
        errors = self.escaped_errors + self.errors_caught
        return self.errors_caught / errors if errors else 1.0


@dataclass(frozen=True, slots=True)
class Evaluation:
    documents: int
    truth_fields: int
    predictions: int
    overall: Counts
    by_kind: Mapping[str, Counts]
    by_doc_type: Mapping[str, Counts]
    calibration: Calibration
    gate: tuple[GateRow, ...]

    def gate_at(self, threshold: float = REVIEW_THRESHOLD) -> GateRow:
        return next(row for row in self.gate if row.threshold == threshold)


@dataclass(frozen=True, slots=True)
class _Judged:
    kind: str
    doc_type: str
    has_value: bool
    correct: bool
    in_truth: bool
    confidence: float | None


def _judge(
    documents: Sequence[SyntheticDocument], predictions: Sequence[Prediction]
) -> tuple[list[_Judged], dict[tuple[str, str], int]]:
    by_id = {doc.doc_id: doc for doc in documents}
    if len(by_id) != len(documents):
        raise ValueError("document ids must be unique")
    seen: set[tuple[str, str]] = set()
    judged: list[_Judged] = []
    for pred in predictions:
        key = (pred.doc_id, pred.label)
        if key in seen:
            raise ValueError(f"duplicate prediction for {key}")
        seen.add(key)
        doc = by_id.get(pred.doc_id)
        if doc is None:
            raise ValueError(f"prediction for unknown document {pred.doc_id!r}")
        truth = doc.field(pred.label)
        has_value = pred.value is not None
        correct = (
            truth is not None
            and pred.value is not None
            and normalize(truth.kind, pred.value) == normalize(truth.kind, truth.value)
        )
        judged.append(
            _Judged(
                kind=truth.kind.value if truth else "unknown",
                doc_type=doc.doc_type,
                has_value=has_value,
                correct=correct,
                in_truth=truth is not None,
                confidence=valid_confidence(pred.confidence),
            )
        )
    # Truth fields nobody predicted are false negatives, grouped for the breakdowns.
    missing: dict[tuple[str, str], int] = {}
    for doc in documents:
        for field in doc.fields:
            if (doc.doc_id, field.label) not in seen:
                group = (field.kind.value, doc.doc_type)
                missing[group] = missing.get(group, 0) + 1
    return judged, missing


def _counts(judged: Sequence[_Judged], missing: int) -> Counts:
    tp = sum(1 for j in judged if j.correct)
    fp = sum(1 for j in judged if j.has_value and not j.correct)
    fn = missing + sum(1 for j in judged if j.in_truth and not j.correct)
    return Counts(tp, fp, fn)


def calibration(outcomes: Sequence[tuple[float, bool]], bins: int = DEFAULT_BINS) -> Calibration:
    """Reliability table and calibration error for (confidence, correct) pairs."""
    if bins < 1:
        raise ValueError("bins must be at least 1")
    grouped: list[list[tuple[float, bool]]] = [[] for _ in range(bins)]
    for confidence, correct in outcomes:
        # Bin by integer math so 0.7 lands in [0.7, 0.8), not just below it.
        index = min(bins - 1, round(confidence * 1_000_000) * bins // 1_000_000)
        grouped[index].append((confidence, correct))
    n = len(outcomes)
    rows: list[ReliabilityBin] = []
    ece = 0.0
    mce = 0.0
    for i, members in enumerate(grouped):
        if not members:
            rows.append(ReliabilityBin(i / bins, (i + 1) / bins, 0, 0.0, 0.0))
            continue
        mean_conf = math.fsum(c for c, _ in members) / len(members)
        acc = sum(1 for _, ok in members if ok) / len(members)
        row = ReliabilityBin(i / bins, (i + 1) / bins, len(members), mean_conf, acc)
        rows.append(row)
        ece += len(members) / n * row.gap
        mce = max(mce, row.gap)
    brier = math.fsum((c - (1.0 if ok else 0.0)) ** 2 for c, ok in outcomes) / n if n else 0.0
    return Calibration(
        scored=n,
        bins=tuple(rows),
        expected_calibration_error=ece,
        max_calibration_error=mce,
        brier_score=brier,
        mean_confidence=math.fsum(c for c, _ in outcomes) / n if n else 0.0,
        accuracy=sum(1 for _, ok in outcomes if ok) / n if n else 0.0,
    )


def _gate_row(judged: Sequence[_Judged], threshold: float) -> GateRow:
    accepted = [
        j for j in judged if j.has_value and j.confidence is not None and j.confidence >= threshold
    ]
    review = [j for j in judged if j not in accepted]
    wrong_review = sum(1 for j in review if j.has_value and not j.correct)
    return GateRow(
        threshold=threshold,
        auto_accepted=len(accepted),
        sent_to_review=len(judged) - len(accepted),
        escaped_errors=sum(1 for j in accepted if not j.correct),
        errors_caught=wrong_review,
    )


def evaluate(
    documents: Sequence[SyntheticDocument],
    predictions: Sequence[Prediction],
    *,
    bins: int = DEFAULT_BINS,
    thresholds: Sequence[float] = DEFAULT_THRESHOLDS,
) -> Evaluation:
    """Score ``predictions`` against the truth in ``documents``."""
    judged, missing = _judge(documents, predictions)
    kinds = sorted({k.value for k in FieldKind} | {j.kind for j in judged})
    doc_types = sorted({doc.doc_type for doc in documents})
    by_kind = {
        kind: _counts(
            [j for j in judged if j.kind == kind],
            sum(n for (k, _), n in missing.items() if k == kind),
        )
        for kind in kinds
        if any(j.kind == kind for j in judged) or any(k == kind for k, _ in missing)
    }
    by_doc_type = {
        doc_type: _counts(
            [j for j in judged if j.doc_type == doc_type],
            sum(n for (_, t), n in missing.items() if t == doc_type),
        )
        for doc_type in doc_types
    }
    outcomes = [
        (j.confidence, j.correct) for j in judged if j.has_value and j.confidence is not None
    ]
    return Evaluation(
        documents=len(documents),
        truth_fields=sum(len(doc.fields) for doc in documents),
        predictions=len(predictions),
        overall=_counts(judged, sum(missing.values())),
        by_kind=by_kind,
        by_doc_type=by_doc_type,
        calibration=calibration(outcomes, bins),
        gate=tuple(_gate_row(judged, t) for t in thresholds),
    )
