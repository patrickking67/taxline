"""Python model vs the TypeScript engine, on shared cases.

Both sides are run for real: this package in-process, ``packages/tax-engine``
through Node. Any difference in a money field fails the test. Set
``TAXLINE_PARITY_REQUIRED=1`` (CI does) to fail instead of skip when Node or the
npm install is missing.
"""

from __future__ import annotations

import os
from decimal import Decimal

import pytest

from taxline_quant import parity

pytestmark = pytest.mark.parity

RANDOM_SEED = 20_260_415
RANDOM_CASES = 5_000


@pytest.fixture(scope="module", autouse=True)
def _require_typescript() -> None:
    if parity.typescript_available():
        return
    message = "Node and `npm ci` at the repo root are needed to run the TypeScript engine"
    if os.environ.get("TAXLINE_PARITY_REQUIRED") == "1":
        pytest.fail(message)
    pytest.skip(message)


def test_constants_agree() -> None:
    output = parity.typescript_output(parity.CASES_FILE)
    assert parity.compare(parity.python_constants(), output["constants"]) == []


def test_shared_cases_agree() -> None:
    cases = parity.load_cases()
    assert len(cases) >= 40
    assert len({c["id"] for c in cases}) == len(cases)
    theirs = parity.typescript_output(parity.CASES_FILE)["results"]
    differences = parity.compare_results(parity.python_results(cases), theirs)
    assert differences == []


def test_seeded_random_cases_agree() -> None:
    cases = parity.random_cases(RANDOM_SEED, RANDOM_CASES)
    theirs = parity.typescript_for_cases(cases)["results"]
    differences = parity.compare_results(parity.python_results(cases), theirs)
    assert differences == [], f"{len(differences)} differences, first: {differences[:5]}"


def test_a_difference_is_reported() -> None:
    """The comparison itself is not vacuous: a one-cent change is caught."""
    cases = parity.load_cases()[:3]
    ours = parity.python_results(cases)
    theirs = parity.python_results(cases)
    theirs[1]["totalTax"] += Decimal("0.01")
    theirs[2]["qbi"]["regime"] = "phase-in-typo"
    differences = parity.compare_results(ours, theirs)
    assert len(differences) == 2
    assert "totalTax" in differences[0]
    assert "qbi.regime" in differences[1]


def test_random_cases_are_reproducible() -> None:
    assert parity.random_cases(7, 50) == parity.random_cases(7, 50)
    assert parity.random_cases(7, 50) != parity.random_cases(8, 50)
