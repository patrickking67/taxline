from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path

import pytest

from taxline_quant import DISCLAIMER, report
from taxline_quant.evals.rules import rules_available

from .node import require_node


@pytest.fixture(scope="module")
def built() -> Mapping[str, str]:
    # Section 5 runs the service's TypeScript extractor, so the report needs Node.
    if not rules_available():
        require_node("the report runs service/eval/extract-corpus.ts")
    return report.build()


def test_committed_report_is_current(built: Mapping[str, str]) -> None:
    """Every number in docs/quant/report.md is what the code produces today."""
    committed = (report.DEFAULT_DIR / report.REPORT_NAME).read_text(encoding="utf-8")
    assert committed == built[report.REPORT_NAME], "run: python -m taxline_quant report"


def test_report_carries_the_disclaimer_and_assumptions(built: Mapping[str, str]) -> None:
    text = built[report.REPORT_NAME]
    assert DISCLAIMER in text
    assert "lognormal" in text
    assert "not a measurement of a model, of OCR, or of real scans" in text
    assert "seed 7 was held out" in text
    assert f"seed {report.MC_SEED}" in text


def test_every_chart_is_written_in_both_themes(built: Mapping[str, str]) -> None:
    charts = sorted(name for name in built if name.endswith(".svg"))
    assert charts == sorted(
        f"{stem}-{theme}.svg"
        for stem in ("rates", "montecarlo", "reliability", "gate")
        for theme in ("light", "dark")
    )
    for name in charts:
        svg = built[name]
        assert svg.startswith("<?xml")
        assert "<svg" in svg
        assert name in built[report.REPORT_NAME]
        assert (report.DEFAULT_DIR / name).exists()
        # Text is kept as text and nothing in the file depends on the clock.
        assert "<text" in svg
        assert "<dc:date>" not in svg


def test_charts_are_deterministic(built: Mapping[str, str]) -> None:
    from taxline_quant import charts  # noqa: PLC0415
    from taxline_quant.scenarios import money_range, sweep  # noqa: PLC0415

    points = sweep(
        report.FILER,
        "self_employment_profit",
        money_range(Decimal(0), report.SWEEP_TOP, report.SWEEP_STEP),
    )
    assert charts.rates_chart(points, charts.DARK) == built["rates-dark.svg"]


def test_check_reports_stale_and_missing_files(tmp_path: Path, built: Mapping[str, str]) -> None:
    assert report.check(tmp_path) == [report.REPORT_NAME]
    written = report.write(tmp_path)
    assert len(written) == 9
    assert report.check(tmp_path) == []
    (tmp_path / report.REPORT_NAME).write_text("stale", encoding="utf-8")
    assert report.check(tmp_path) == [report.REPORT_NAME]
