"""Extraction scoring. The fixture in tests/data is small enough to score by
hand; the expected numbers below were worked that way."""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from taxline_quant.evals import (
    CALIBRATED,
    OVERCONFIDENT,
    REVIEW_THRESHOLD,
    FieldKind,
    Prediction,
    calibration,
    evaluate,
    generate_documents,
    normalize,
    simulate_extraction,
)
from taxline_quant.evals.recorded import (
    load_predictions,
    load_truth,
    predictions_from_json,
    predictions_to_json,
    truth_from_json,
    truth_to_json,
)

DATA = Path(__file__).parent / "data"
TRUTH = load_truth(DATA / "extraction_truth.json")
RECORDED = load_predictions(DATA / "extraction_recorded.json")


def test_normalization() -> None:
    assert normalize(FieldKind.MONEY, "$128,400.00") == normalize(FieldKind.MONEY, "128400")
    assert normalize(FieldKind.MONEY, "$6,180.00") != normalize(FieldKind.MONEY, "$6,810.00")
    assert normalize(FieldKind.MONEY, "n/a") == "n/a"
    assert normalize(FieldKind.ID, "00-0000001") == normalize(FieldKind.ID, "00 0000001")
    assert normalize(FieldKind.TEXT, "  Juniper   Works LLC ") == "juniper works llc"


def test_fixture_counts_by_hand() -> None:
    ev = evaluate(TRUTH, RECORDED)
    assert (ev.documents, ev.truth_fields, ev.predictions) == (2, 10, 10)
    # Correct: employer, EIN, wages, federal w/h, payer, nonemployee comp.
    # Wrong values: state w/h, payer TIN, and a field the 1099 does not have.
    # Missed: state w/h, local code (declined), payer TIN, federal w/h box 4 (absent).
    assert (ev.overall.true_positive, ev.overall.false_positive, ev.overall.false_negative) == (
        6,
        3,
        4,
    )
    assert ev.overall.precision == pytest.approx(6 / 9)
    assert ev.overall.recall == pytest.approx(6 / 10)
    assert ev.overall.f1 == pytest.approx(12 / 19)


def test_fixture_breakdowns_by_hand() -> None:
    ev = evaluate(TRUTH, RECORDED)
    money, ids, text = ev.by_kind["money"], ev.by_kind["id"], ev.by_kind["text"]
    assert (money.true_positive, money.false_positive, money.false_negative) == (3, 1, 2)
    assert (ids.true_positive, ids.false_positive, ids.false_negative) == (1, 1, 1)
    assert (text.true_positive, text.false_positive, text.false_negative) == (2, 0, 1)
    assert ev.by_kind["unknown"].false_positive == 1
    w2, nec = ev.by_doc_type["W-2"], ev.by_doc_type["1099-NEC"]
    assert (w2.true_positive, w2.false_positive, w2.false_negative) == (4, 1, 2)
    assert (nec.true_positive, nec.false_positive, nec.false_negative) == (2, 2, 2)
    # The breakdowns partition the overall counts.
    assert sum(c.true_positive for c in ev.by_kind.values()) == ev.overall.true_positive
    assert sum(c.false_negative for c in ev.by_doc_type.values()) == ev.overall.false_negative


def test_fixture_calibration_by_hand() -> None:
    cal = evaluate(TRUTH, RECORDED).calibration
    assert cal.scored == 9  # the declined field has no confidence
    filled = {round(b.lower, 1): b for b in cal.bins if b.count}
    assert sorted(filled) == [0.6, 0.7, 0.8, 0.9]
    assert (filled[0.6].count, filled[0.6].accuracy) == (1, 0.0)
    assert filled[0.7].count == 2
    assert filled[0.7].mean_confidence == pytest.approx(0.76)
    assert filled[0.7].accuracy == 0.5
    assert (filled[0.8].count, filled[0.8].accuracy) == (1, 0.0)
    assert filled[0.9].count == 5
    assert filled[0.9].mean_confidence == pytest.approx(0.958)
    assert filled[0.9].accuracy == 1.0
    # (1 x 0.62 + 2 x 0.26 + 1 x 0.88 + 5 x 0.042) / 9
    assert cal.expected_calibration_error == pytest.approx(2.23 / 9)
    assert cal.max_calibration_error == pytest.approx(0.88)
    assert cal.mean_confidence == pytest.approx(7.81 / 9)
    assert cal.accuracy == pytest.approx(6 / 9)
    assert cal.brier_score == pytest.approx(1.7673 / 9)


def test_fixture_review_gate_by_hand() -> None:
    row = evaluate(TRUTH, RECORDED).gate_at(REVIEW_THRESHOLD)
    # Six fields clear 0.85; one of them (payer TIN at 0.88) is wrong.
    assert (row.auto_accepted, row.sent_to_review) == (6, 4)
    assert row.escaped_errors == 1
    assert row.errors_caught == 2  # state w/h at 0.74 and the invented field at 0.62
    assert row.escape_rate == pytest.approx(1 / 6)
    assert row.catch_rate == pytest.approx(2 / 3)
    assert row.review_rate == pytest.approx(0.4)


def test_recorded_shape_round_trips() -> None:
    assert truth_from_json(truth_to_json(TRUTH)) == TRUTH
    assert predictions_from_json(predictions_to_json(TRUTH, RECORDED)) == RECORDED
    with pytest.raises(ValueError, match="list of documents"):
        truth_from_json({"docId": "x"})


def test_a_non_numeric_confidence_is_no_confidence() -> None:
    raw = json.loads((DATA / "extraction_recorded.json").read_text(encoding="utf-8"))
    raw[0]["fields"][0]["confidence"] = "0.99"
    raw[0]["fields"][1]["confidence"] = 1.7
    preds = predictions_from_json(raw)
    assert preds[0].confidence is None
    ev = evaluate(TRUTH, preds)
    # Both fields now go to review whatever the threshold, as in the service.
    assert ev.calibration.scored == 7
    assert ev.gate_at(REVIEW_THRESHOLD).auto_accepted == 4


def test_bad_input_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown document"):
        evaluate(TRUTH, [Prediction("nope", "EIN", "1", 0.9)])
    with pytest.raises(ValueError, match="duplicate prediction"):
        evaluate(TRUTH, [*RECORDED, RECORDED[0]])
    with pytest.raises(ValueError, match="unique"):
        evaluate([*TRUTH, TRUTH[0]], RECORDED)


def test_generation_is_deterministic_and_synthetic() -> None:
    docs = generate_documents(7, 30)
    assert docs == generate_documents(7, 30)
    assert docs != generate_documents(8, 30)
    assert {d.doc_type for d in docs} == {"W-2", "1099-NEC", "1099-INT"}
    assert len({d.doc_id for d in docs}) == 30
    for doc in docs:
        for field in doc.fields:
            if field.kind is FieldKind.ID:
                assert field.value.startswith("00-")  # never a real EIN prefix
            if field.kind is FieldKind.MONEY:
                assert field.value.startswith("$")
        assert doc.fields[0].value in doc.text()
    assert generate_documents(7, 0) == ()


def test_simulation_is_deterministic_and_offline() -> None:
    docs = generate_documents(7, 60)
    a = simulate_extraction(docs, OVERCONFIDENT, seed=7)
    assert a == simulate_extraction(docs, OVERCONFIDENT, seed=7)
    assert a != simulate_extraction(docs, OVERCONFIDENT, seed=8)
    assert all(p.confidence is None or 0 < p.confidence <= 1 for p in a)
    assert all((p.value is None) == (p.confidence is None) for p in a)


def test_profiles_differ_in_calibration_not_accuracy() -> None:
    docs = generate_documents(7, 600)
    honest = evaluate(docs, simulate_extraction(docs, CALIBRATED, seed=7))
    inflated = evaluate(docs, simulate_extraction(docs, OVERCONFIDENT, seed=7))
    # Same draws decide right and wrong, so the accuracy is identical.
    assert honest.overall == inflated.overall
    assert honest.calibration.expected_calibration_error < 0.02
    assert inflated.calibration.expected_calibration_error > 0.03
    assert inflated.calibration.mean_confidence > inflated.calibration.accuracy
    # At the service's threshold the inflated scores let about twice as many errors through.
    assert (
        inflated.gate_at(REVIEW_THRESHOLD).escaped_errors
        > 1.5 * honest.gate_at(REVIEW_THRESHOLD).escaped_errors
    )
    assert (
        inflated.gate_at(REVIEW_THRESHOLD).catch_rate < honest.gate_at(REVIEW_THRESHOLD).catch_rate
    )


def test_a_perfect_extractor_scores_one() -> None:
    docs = generate_documents(3, 12)
    perfect = [Prediction(d.doc_id, f.label, f.value, 1.0) for d in docs for f in d.fields]
    ev = evaluate(docs, perfect)
    assert ev.overall.precision == ev.overall.recall == ev.overall.f1 == 1.0
    assert ev.calibration.expected_calibration_error == 0.0
    assert ev.calibration.brier_score == 0.0
    assert ev.gate_at(REVIEW_THRESHOLD).sent_to_review == 0


def test_an_empty_run_is_all_false_negatives() -> None:
    docs = generate_documents(3, 6)
    ev = evaluate(docs, [])
    assert ev.overall.true_positive == 0
    assert ev.overall.false_negative == ev.truth_fields
    assert ev.overall.precision == ev.overall.recall == ev.overall.f1 == 0.0
    assert ev.calibration.scored == 0


outcome_lists = st.lists(
    st.tuples(st.integers(min_value=0, max_value=100).map(lambda n: n / 100), st.booleans()),
    min_size=1,
    max_size=200,
)


@given(outcome_lists, st.integers(min_value=1, max_value=20))
def test_calibration_invariants(outcomes: list[tuple[float, bool]], bins: int) -> None:
    cal = calibration(outcomes, bins)
    assert sum(b.count for b in cal.bins) == len(outcomes) == cal.scored
    assert len(cal.bins) == bins
    assert 0.0 <= cal.expected_calibration_error <= cal.max_calibration_error <= 1.0
    assert 0.0 <= cal.brier_score <= 1.0
    for b in cal.bins:
        if b.count:
            assert b.lower - 1e-9 <= b.mean_confidence <= b.upper + 1e-9
    # One bin reduces to |mean confidence - accuracy|.
    single = calibration(outcomes, 1)
    assert single.expected_calibration_error == pytest.approx(
        abs(single.mean_confidence - single.accuracy)
    )


@given(st.integers(min_value=0, max_value=10_000), st.integers(min_value=1, max_value=40))
def test_scoring_ignores_prediction_order(seed: int, count: int) -> None:
    docs = generate_documents(seed, count)
    preds = list(simulate_extraction(docs, OVERCONFIDENT, seed))
    shuffled = preds[:]
    random.Random(seed).shuffle(shuffled)
    a, b = evaluate(docs, preds), evaluate(docs, shuffled)
    assert a.overall == b.overall
    assert a.gate == b.gate
    assert a.calibration.expected_calibration_error == pytest.approx(
        b.calibration.expected_calibration_error
    )
    for row in a.gate:
        assert row.auto_accepted + row.sent_to_review == len(preds)
        assert row.escaped_errors <= row.auto_accepted
    accepted = [row.auto_accepted for row in a.gate]
    assert accepted == sorted(accepted, reverse=True)
