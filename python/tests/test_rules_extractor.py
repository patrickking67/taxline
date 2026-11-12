"""The rendered documents and the service's rules extractor run over them.

The extractor is TypeScript and runs through Node, like the parity tests. It is
deterministic and offline: no model API is called here or anywhere in the suite.
"""

from __future__ import annotations

import random
from decimal import Decimal

import pytest

from taxline_quant.evals import (
    QUALITIES,
    REVIEW_THRESHOLD,
    Prediction,
    RenderedDocument,
    ScanQuality,
    evaluate,
    generate_documents,
    render_documents,
    rules_available,
    run_rules_extractor,
)
from taxline_quant.evals.render import LAYOUTS, clean_lines, damage

from .node import require_node

SEED = 7
PERFECT = ScanQuality("perfect", share_pct=100, char_error_per_mille=0, line_drop_per_mille=0)


def _amounts(lines: list[str]) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for line in lines[1:]:
        caption, _, value = line.rpartition("  ")
        try:
            out[caption.split(" ", 1)[0]] = Decimal(value.replace(",", ""))
        except ArithmeticError:
            continue
    return out


def test_rendering_is_deterministic_and_covers_every_layout_and_quality() -> None:
    docs = generate_documents(SEED, 300)
    rendered = render_documents(docs, SEED)
    assert rendered == render_documents(docs, SEED)
    assert rendered != render_documents(docs, SEED + 1)
    assert [r.doc_id for r in rendered] == [d.doc_id for d in docs]
    assert {r.layout for r in rendered} == set(LAYOUTS)
    assert {r.quality for r in rendered} == {q.name for q in QUALITIES}
    clean = sum(r.quality == "clean" for r in rendered)
    assert 0.6 < clean / len(rendered) < 0.8


def test_a_rendered_w2_ties_out_by_hand() -> None:
    """The support boxes follow from the truth: 6.2%, 1.45%, and box 1 + 12a = box 5."""
    seen_deferral = False
    for doc in generate_documents(SEED, 90):
        if doc.doc_type != "W-2":
            continue
        box = _amounts(clean_lines(doc, "form", random.Random(doc.doc_id)))
        deferral = box.get("12a", Decimal(0))
        seen_deferral = seen_deferral or deferral > 0
        assert box["1"] + deferral == box["5"]
        assert box["3"] == min(box["5"], Decimal(184_500))
        assert box["4"] == (box["3"] * Decimal("0.062")).quantize(Decimal("0.01"), "ROUND_HALF_UP")
        assert box["6"] == (box["5"] * Decimal("0.0145")).quantize(Decimal("0.01"), "ROUND_HALF_UP")
        assert box["16"] == box["1"]
        assert box["17"] <= box["16"]
    assert seen_deferral


def test_damage_respects_the_quality() -> None:
    lines = clean_lines(generate_documents(SEED, 1)[0], "summary", random.Random(1))
    assert damage(lines, PERFECT, random.Random(1)) == lines
    wrecked = ScanQuality("wrecked", 100, char_error_per_mille=1000, line_drop_per_mille=0)
    out = damage(lines, wrecked, random.Random(1))
    assert len(out) == len(lines)
    assert all(a != b for a, b in zip(out, lines, strict=True))
    gone = ScanQuality("gone", 100, char_error_per_mille=0, line_drop_per_mille=1000)
    assert damage(lines, gone, random.Random(1)) == lines[:1]


@pytest.fixture(scope="module")
def _node() -> None:
    if not rules_available():
        require_node("the rules extractor is TypeScript")


@pytest.mark.usefixtures("_node")
def test_undamaged_documents_are_read_perfectly_in_both_layouts() -> None:
    docs = generate_documents(SEED, 60)
    rendered = [
        RenderedDocument(
            d.doc_id,
            d.doc_type,
            layout,
            PERFECT.name,
            "\n".join(clean_lines(d, layout, random.Random(d.doc_id))),
        )
        for d, layout in zip(docs, LAYOUTS * 30, strict=True)
    ]
    preds = run_rules_extractor(rendered)
    ev = evaluate(docs, preds)
    assert ev.overall.precision == ev.overall.recall == 1.0
    assert ev.gate_at(REVIEW_THRESHOLD).sent_to_review == 0
    assert all(p.confidence is not None and p.confidence >= 0.97 for p in preds)


@pytest.mark.usefixtures("_node")
def test_the_extractor_is_deterministic_and_reports_only_form_fields() -> None:
    docs = generate_documents(SEED, 120)
    rendered = render_documents(docs, SEED)
    preds = run_rules_extractor(rendered)
    assert preds == run_rules_extractor(rendered)
    labels = {d.doc_id: {f.label for f in d.fields} for d in docs}
    # The form is detected from the text; every label belongs to the true form.
    assert all(p.label in labels[p.doc_id] for p in preds)
    assert all((p.value is None) == (p.confidence is None) for p in preds)
    assert all(isinstance(p, Prediction) for p in preds)


@pytest.mark.usefixtures("_node")
def test_held_out_scores_stay_in_range() -> None:
    """Loose bounds on the report's seed, so a regression in the extractor fails here."""
    docs = generate_documents(SEED, 600)
    rendered = render_documents(docs, SEED)
    preds = run_rules_extractor(rendered)
    ev = evaluate(docs, preds)
    assert ev.overall.precision > 0.94
    assert ev.overall.recall > 0.90
    assert ev.calibration.expected_calibration_error < 0.03
    gate = ev.gate_at(REVIEW_THRESHOLD)
    assert gate.escape_rate < 0.025
    assert gate.catch_rate > 0.5
    # Confidence tracks damage: clean scans are trusted more than poor ones.
    by_quality = {r.doc_id: r.quality for r in rendered}

    def mean(quality: str) -> float:
        scores = [p.confidence for p in preds if by_quality[p.doc_id] == quality and p.confidence]
        return sum(scores) / len(scores)

    assert mean("clean") > mean("smudged") > mean("poor")
