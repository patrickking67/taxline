"""Read and write recorded extraction runs.

A recorded run is a JSON list of documents in the shape the service's
``extract_fields`` tool returns (``docId``, ``docType``, ``fields`` with
``label``, ``value``, ``confidence``). Ground truth uses the same shape with a
``kind`` on each field and no confidence. Replaying a recording is how a real
model's output would be scored here without calling the model in tests.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .documents import FieldKind, SyntheticDocument, TruthField
from .extractor import Prediction


def _documents(raw: object, source: str) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not all(isinstance(d, dict) for d in raw):
        raise ValueError(f"{source}: expected a JSON list of documents")
    return raw


def truth_from_json(raw: object, source: str = "truth") -> tuple[SyntheticDocument, ...]:
    docs: list[SyntheticDocument] = []
    for doc in _documents(raw, source):
        fields = tuple(
            TruthField(str(f["label"]), str(f["value"]), FieldKind(f["kind"]))
            for f in doc["fields"]
        )
        docs.append(SyntheticDocument(str(doc["docId"]), str(doc["docType"]), fields))
    return tuple(docs)


def predictions_from_json(raw: object, source: str = "recording") -> tuple[Prediction, ...]:
    out: list[Prediction] = []
    for doc in _documents(raw, source):
        for f in doc["fields"]:
            value = f.get("value")
            confidence = f.get("confidence")
            if confidence is not None and (
                isinstance(confidence, bool) or not isinstance(confidence, int | float)
            ):
                # The service treats a non-numeric score as no score at all.
                confidence = None
            out.append(
                Prediction(
                    doc_id=str(doc["docId"]),
                    label=str(f["label"]),
                    value=None if value is None else str(value),
                    confidence=None if confidence is None else float(confidence),
                )
            )
    return tuple(out)


def load_truth(path: Path) -> tuple[SyntheticDocument, ...]:
    return truth_from_json(json.loads(path.read_text(encoding="utf-8")), str(path))


def load_predictions(path: Path) -> tuple[Prediction, ...]:
    return predictions_from_json(json.loads(path.read_text(encoding="utf-8")), str(path))


def truth_to_json(documents: Sequence[SyntheticDocument]) -> list[dict[str, Any]]:
    return [
        {
            "docId": doc.doc_id,
            "docType": doc.doc_type,
            "fields": [
                {"label": f.label, "value": f.value, "kind": f.kind.value} for f in doc.fields
            ],
        }
        for doc in documents
    ]


def predictions_to_json(
    documents: Sequence[SyntheticDocument], predictions: Sequence[Prediction]
) -> list[dict[str, Any]]:
    by_doc: dict[str, list[Prediction]] = {doc.doc_id: [] for doc in documents}
    for pred in predictions:
        by_doc.setdefault(pred.doc_id, []).append(pred)
    types = {doc.doc_id: doc.doc_type for doc in documents}
    return [
        {
            "docId": doc_id,
            "docType": types.get(doc_id, "unknown"),
            "fields": [
                {"label": p.label, "value": p.value, "confidence": p.confidence} for p in preds
            ],
        }
        for doc_id, preds in by_doc.items()
    ]
