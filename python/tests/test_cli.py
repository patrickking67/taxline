from __future__ import annotations

import json
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import pytest

from taxline_quant import DISCLAIMER
from taxline_quant.cli import main
from taxline_quant.constants import constants_markdown

DATA = Path(__file__).parent / "data"


def run(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str, str]:
    code = main(list(argv))
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_tax_text_output(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "tax", "--status", "single", "--wages", "85,000")
    assert code == 0
    assert "9,876.00" in out
    assert "Amount owed" in out
    assert DISCLAIMER in out


def test_tax_json_output_is_exact(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(
        capsys,
        "tax",
        "--status",
        "single",
        "--se-profit",
        "100000",
        "--prior-year-tax",
        "20000",
        "--prior-year-agi",
        "90000",
        "--json",
    )
    assert code == 0
    payload = json.loads(out)
    # Amounts are strings so no consumer reads them back as floats.
    assert payload["lines"]["total_tax"] == "22366.55"
    assert payload["qbi_regime"] == "below-threshold"
    assert payload["estimated"]["safe_harbor"] == "20000.00"
    assert sum(Decimal(v) for v in payload["estimated"]["installments"].values()) == 20_000
    assert payload["disclaimer"] == DISCLAIMER


def test_sweep(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(
        capsys,
        "sweep",
        "--status",
        "single",
        "--vary",
        "wages",
        "--start",
        "50000",
        "--stop",
        "100000",
        "--step",
        "25000",
        "--json",
    )
    assert code == 0
    points = json.loads(out)["points"]
    assert [p["x"] for p in points] == ["50000", "75000", "100000"]
    assert Decimal(points[0]["total_tax"]) < Decimal(points[2]["total_tax"])


def test_montecarlo_is_reproducible(capsys: pytest.CaptureFixture[str]) -> None:
    argv = (
        "montecarlo",
        "--status",
        "single",
        "--se-profit",
        "120000",
        "--cv",
        "0.35",
        "--draws",
        "500",
        "--seed",
        "7",
        "--json",
    )
    _, first, _ = run(capsys, *argv)
    _, second, _ = run(capsys, *argv)
    assert first == second
    payload = json.loads(first)
    assert payload["draws"] == 500
    assert payload["plans"][0]["name"] == "forecast-90"
    assert any("lognormal" in a for a in payload["assumptions"])


def test_eval_on_the_recorded_fixture(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(
        capsys,
        "eval",
        "--truth",
        str(DATA / "extraction_truth.json"),
        "--recorded",
        str(DATA / "extraction_recorded.json"),
        "--json",
    )
    assert code == 0
    payload = json.loads(out)
    assert payload["precision"] == pytest.approx(6 / 9)
    assert payload["gate"]["escaped_errors"] == 1
    code, _, err = run(capsys, "eval", "--truth", str(DATA / "extraction_truth.json"))
    assert code == 2
    assert "go together" in err


def test_eval_simulated(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "eval", "--documents", "60", "--profile", "calibrated")
    assert code == 0
    assert "simulated extractor (calibrated), seed 7" in out
    assert "gate at 0.85" in out


def test_eval_defaults_to_the_rules_extractor(capsys: pytest.CaptureFixture[str]) -> None:
    from taxline_quant.evals import rules_available  # noqa: PLC0415

    from .node import require_node  # noqa: PLC0415

    if not rules_available():
        require_node("the rules extractor is TypeScript")
    code, out, _ = run(capsys, "eval", "--documents", "30")
    assert code == 0
    assert "rules extractor (service/src/extract), seed 7" in out


def test_constants(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "constants", "--markdown")
    assert code == 0
    assert out == constants_markdown()
    code, out, _ = run(capsys, "constants")
    assert "Rev. Proc. 2025-32 sec. 4.14(1)" in out


def test_bad_input_exits_2(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["tax", "--status", "single", "--wages", "lots"])
    assert excinfo.value.code == 2
    assert "not an amount" in capsys.readouterr().err
    code, _, err = run(capsys, "tax", "--status", "single", "--wages", "-5")
    assert code == 2
    assert "cannot be negative" in err
    code, _, err = run(
        capsys, "montecarlo", "--status", "single", "--wages", "50000", "--cv", "0.3"
    )
    assert code == 2
    assert "must be positive" in err


def test_module_entry_point() -> None:
    done = subprocess.run(
        [sys.executable, "-m", "taxline_quant", "tax", "--status", "mfj", "--wages", "120000"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0
    # Taxable 87,800 -> row midpoint 87,825: 2,480 + 12% x 63,025 = 10,043
    assert "10,043.00" in done.stdout
