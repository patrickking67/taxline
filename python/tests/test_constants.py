"""The TY2026 figures against what Rev. Proc. 2025-32 prints.

The expected values here were read from the revenue procedure itself (section
4.01 Tables 1-4, section 4.14, section 4.26), not from this package or from the
TypeScript engine.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path

from taxline_quant import TY2026, FilingStatus, base_amounts
from taxline_quant.constants import constant_table, constants_markdown

DOCS_TABLE = Path(__file__).resolve().parents[2] / "docs" / "quant" / "constants.md"

# "The tax is: $X plus r% of the excess over $Y" - the $X column, per table.
PRINTED_BASE_AMOUNTS = {
    FilingStatus.MFJ: ["0", "2480", "11600", "35932", "82048", "116896", "206583.50"],
    FilingStatus.HOH: ["0", "1770", "7740", "16155", "39207", "56631", "191171"],
    FilingStatus.SINGLE: ["0", "1240", "5800", "17966", "41024", "58448", "192979.25"],
    FilingStatus.MFS: ["0", "1240", "5800", "17966", "41024", "58448", "103291.75"],
}


def test_base_amounts_match_the_printed_tables() -> None:
    for status, printed in PRINTED_BASE_AMOUNTS.items():
        assert list(base_amounts(TY2026.brackets[status])) == [Decimal(x) for x in printed]


def test_rates_are_the_seven_statutory_rates() -> None:
    expected = [Decimal(x) for x in ("0.10", "0.12", "0.22", "0.24", "0.32", "0.35", "0.37")]
    for status in FilingStatus:
        bands = TY2026.brackets[status]
        assert [b.rate for b in bands] == expected
        floors = [b.floor for b in bands]
        assert floors[0] == 0
        assert floors == sorted(set(floors))


def test_standard_deduction() -> None:
    assert TY2026.standard_deduction[FilingStatus.MFJ] == 32_200
    assert TY2026.standard_deduction[FilingStatus.HOH] == 24_150
    assert TY2026.standard_deduction[FilingStatus.SINGLE] == 16_100
    assert TY2026.standard_deduction[FilingStatus.MFS] == 16_100


def test_qbi_range_tops_match_the_printed_table() -> None:
    # Section 4.26 prints the threshold and the top of the phase-in range.
    printed = {
        FilingStatus.MFJ: (403_500, 553_500),
        FilingStatus.MFS: (201_775, 276_775),
        FilingStatus.SINGLE: (201_750, 276_750),
        FilingStatus.HOH: (201_750, 276_750),
    }
    for status, (threshold, top) in printed.items():
        assert TY2026.qbi.threshold[status] == threshold
        assert TY2026.qbi.threshold[status] + TY2026.qbi.phase_in_range[status] == top


def test_se_factor_is_one_less_half_the_combined_rate() -> None:
    se = TY2026.se
    assert se.net_earnings_factor == 1 - (se.social_security_rate + se.medicare_rate) / 2
    assert se.wage_base == 184_500


def _leaf_paths(obj: object, prefix: str = "") -> set[str]:
    paths: set[str] = set()
    for f in dataclasses.fields(obj):  # type: ignore[arg-type]
        value = getattr(obj, f.name)
        path = f"{prefix}{f.name}"
        if dataclasses.is_dataclass(value):
            paths |= _leaf_paths(value, f"{path}.")
        elif f.name == "brackets" and isinstance(value, Mapping):
            paths |= {f"{path}.{status.value}" for status in value}
        else:
            paths.add(path)
    return paths


def test_every_constant_has_a_citation() -> None:
    documented = {row.path for row in constant_table()}
    assert documented == _leaf_paths(TY2026) - {"year"}
    for row in constant_table():
        assert row.source.label
        assert row.source.url.startswith("https://")
        assert row.value


def test_docs_table_is_current() -> None:
    assert DOCS_TABLE.read_text(encoding="utf-8") == constants_markdown()
