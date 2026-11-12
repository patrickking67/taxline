"""Render synthetic documents as the text a scan would yield, damage included.

The rules extractor in ``service/src/extract`` reads a text layer, so the
evaluation needs text with known truth and known damage. Each document is laid
out in one of two ways (the IRS form captions, or a payroll-style summary), then
passed through a seeded noise model: a character may be read as a look-alike
(``0`` as ``O``), as another digit or letter, as an unreadable mark, or lost, and
a whole line may be missing. Three scan qualities set how often that happens.

A W-2 is rendered with the boxes that tie to the reported ones (social security
and Medicare wages and tax, elective deferrals, state wages), computed from the
truth, so the extractor's arithmetic checks have something real to check.

Integer draws only, so a seed gives the same text on every platform. The noise
model is a stand-in for a scanner, not a measurement of one.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from .documents import INT, NEC, W2, SyntheticDocument

FORM_YEAR: Final = 2026
_CENT: Final = Decimal("0.01")
# Rates and the wage base as printed on a 2026 Form W-2: IRC 3101(a) and
# 3101(b)(1); SSA, 90 FR 49047 (2025-11-03), for the contribution and benefit base.
_SS_RATE: Final = Decimal("0.062")
_MEDICARE_RATE: Final = Decimal("0.0145")
_SS_WAGE_BASE: Final = Decimal(184_500)


@dataclass(frozen=True, slots=True)
class ScanQuality:
    name: str
    share_pct: int
    """Percent of documents scanned at this quality."""
    char_error_per_mille: int
    """Chance, per thousand, that a character is misread."""
    line_drop_per_mille: int
    """Chance, per thousand, that a line is missing."""


QUALITIES: Final = (
    ScanQuality("clean", share_pct=70, char_error_per_mille=2, line_drop_per_mille=0),
    ScanQuality("smudged", share_pct=22, char_error_per_mille=25, line_drop_per_mille=10),
    ScanQuality("poor", share_pct=8, char_error_per_mille=80, line_drop_per_mille=50),
)
LAYOUTS: Final = ("form", "summary")


@dataclass(frozen=True, slots=True)
class RenderedDocument:
    doc_id: str
    doc_type: str
    layout: str
    quality: str
    text: str


_DIGIT_LOOKALIKES: Final = {
    "0": "O",
    "1": "lI",
    "2": "Z",
    "3": "EB",
    "4": "A",
    "5": "S",
    "6": "G",
    "7": "TZ",
    "8": "B",
    "9": "g",
}
_LETTER_LOOKALIKES: Final = {
    "O": "0",
    "o": "0",
    "l": "1",
    "I": "1",
    "Z": "2",
    "z": "2",
    "E": "3",
    "A": "4",
    "S": "5",
    "s": "5",
    "G": "6",
    "T": "7",
    "B": "8",
    "g": "9",
}
_UPPER: Final = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_LOWER: Final = _UPPER.lower()
_UNREADABLE: Final = "~"


def _money(amount: Decimal) -> str:
    return f"{amount:,.2f}"


def _half_up(amount: Decimal) -> Decimal:
    return amount.quantize(_CENT, rounding=ROUND_HALF_UP)


def _amount(doc: SyntheticDocument, label: str) -> Decimal:
    field = doc.field(label)
    if field is None:
        raise ValueError(f"{doc.doc_id}: no field {label!r}")
    return Decimal(field.value.replace("$", "").replace(",", ""))


def _value(doc: SyntheticDocument, label: str) -> str:
    field = doc.field(label)
    if field is None:
        raise ValueError(f"{doc.doc_id}: no field {label!r}")
    return field.value


def _w2_rows(doc: SyntheticDocument, rng: random.Random) -> list[tuple[str, str, str]]:
    """(form caption, summary caption, value) for every printed W-2 line."""
    wages = _amount(doc, "Wages · box 1")
    deferral = Decimal(0)
    if rng.randint(1, 100) <= 30:
        deferral = _half_up(wages * rng.randint(3, 10) / 100)
    medicare_wages = wages + deferral
    ss_wages = min(medicare_wages, _SS_WAGE_BASE)
    rows = [
        ("b Employer identification number (EIN)", "Employer ID (EIN)", _value(doc, "EIN")),
        ("c Employer's name, address, and ZIP code", "Employer", _value(doc, "Employer")),
        ("1 Wages, tips, other compensation", "Box 1 Wages", _money(wages)),
        (
            "2 Federal income tax withheld",
            "Box 2 Federal tax withheld",
            _money(_amount(doc, "Federal w/h · box 2")),
        ),
        ("3 Social security wages", "Box 3 Social security wages", _money(ss_wages)),
        (
            "4 Social security tax withheld",
            "Box 4 Social security tax",
            _money(_half_up(ss_wages * _SS_RATE)),
        ),
        ("5 Medicare wages and tips", "Box 5 Medicare wages", _money(medicare_wages)),
        (
            "6 Medicare tax withheld",
            "Box 6 Medicare tax",
            _money(_half_up(medicare_wages * _MEDICARE_RATE)),
        ),
    ]
    if deferral:
        rows.append(("12a Code D", "Box 12a Code D", _money(deferral)))
    rows += [
        ("16 State wages, tips, etc.", "Box 16 State wages", _money(wages)),
        (
            "17 State income tax",
            "Box 17 State tax withheld",
            _money(_amount(doc, "State w/h · box 17")),
        ),
        ("20 Locality name", "Box 20 Locality", _value(doc, "Local code · box 20")),
    ]
    return rows


def _payer_rows(doc: SyntheticDocument) -> list[tuple[str, str, str]]:
    return [
        ("PAYER'S name", "Payer", _value(doc, "Payer")),
        ("PAYER'S TIN", "Payer TIN", _value(doc, "Payer TIN")),
    ]


def _nec_rows(doc: SyntheticDocument) -> list[tuple[str, str, str]]:
    return [
        *_payer_rows(doc),
        (
            "1 Nonemployee compensation",
            "Box 1 Nonemployee compensation",
            _money(_amount(doc, "Nonemployee comp · box 1")),
        ),
        (
            "4 Federal income tax withheld",
            "Box 4 Federal tax withheld",
            _money(_amount(doc, "Federal w/h · box 4")),
        ),
    ]


def _int_rows(doc: SyntheticDocument) -> list[tuple[str, str, str]]:
    return [
        *_payer_rows(doc),
        (
            "1 Interest income",
            "Box 1 Interest income",
            _money(_amount(doc, "Interest income · box 1")),
        ),
        (
            "2 Early withdrawal penalty",
            "Box 2 Early withdrawal penalty",
            _money(_amount(doc, "Early withdrawal penalty · box 2")),
        ),
    ]


_TITLES: Final = {
    W2: ("Form W-2 Wage and Tax Statement", "W-2 Wage and Tax Statement, employee summary"),
    NEC: ("Form 1099-NEC Nonemployee Compensation", "1099-NEC Nonemployee Compensation summary"),
    INT: ("Form 1099-INT Interest Income", "1099-INT Interest Income summary"),
}


def clean_lines(doc: SyntheticDocument, layout: str, rng: random.Random) -> list[str]:
    """The document's lines before any damage."""
    if layout not in LAYOUTS:
        raise ValueError(f"unknown layout {layout!r}")
    if doc.doc_type == W2:
        rows = _w2_rows(doc, rng)
    elif doc.doc_type == NEC:
        rows = _nec_rows(doc)
    elif doc.doc_type == INT:
        rows = _int_rows(doc)
    else:
        raise ValueError(f"{doc.doc_id}: no layout for {doc.doc_type!r}")
    form_title, summary_title = _TITLES[doc.doc_type]
    if layout == "form":
        return [f"{form_title} {FORM_YEAR}", *[f"{cap}  {value}" for cap, _, value in rows]]
    lines = [f"{summary_title} {FORM_YEAR}"]
    for _, cap, value in rows:
        shown = f"${value}" if value[:1].isdigit() and "." in value else value
        lines.append(f"{cap}: {shown}")
    return lines


def _other(rng: random.Random, pool: str, ch: str) -> str:
    choices = [c for c in pool if c != ch]
    return rng.choice(choices)


def _misread_digit(rng: random.Random, ch: str, roll: int) -> str:
    if roll <= 30:
        return _other(rng, "0123456789", ch)
    if roll <= 75:
        return rng.choice(_DIGIT_LOOKALIKES[ch])
    return _UNREADABLE if roll <= 85 else ""


def _misread_letter(rng: random.Random, ch: str, roll: int) -> str:
    pool = _UPPER if ch in _UPPER else _LOWER
    if roll <= 25:
        return _other(rng, pool, ch)
    if roll <= 70:
        return _LETTER_LOOKALIKES.get(ch) or _other(rng, pool, ch)
    return _UNREADABLE if roll <= 80 else ""


def _misread(rng: random.Random, ch: str) -> str:
    """One damaged character. An empty string means the character was lost."""
    roll = rng.randint(1, 100)
    if ch.isdigit():
        return _misread_digit(rng, ch, roll)
    if ch in _UPPER or ch in _LOWER:
        return _misread_letter(rng, ch, roll)
    # Punctuation is lost more often than it is misread.
    return "" if roll <= 60 else {".": ",", ",": ".", "-": "."}.get(ch, "")


def damage(lines: Sequence[str], quality: ScanQuality, rng: random.Random) -> list[str]:
    out: list[str] = []
    for n, line in enumerate(lines):
        # The title line is never dropped; a page with no heading is another problem.
        if n and rng.randint(1, 1000) <= quality.line_drop_per_mille:
            continue
        chars: list[str] = []
        for ch in line:
            if ch != " " and rng.randint(1, 1000) <= quality.char_error_per_mille:
                chars.append(_misread(rng, ch))
            else:
                chars.append(ch)
        out.append("".join(chars))
    return out


def _pick_quality(rng: random.Random) -> ScanQuality:
    roll = rng.randint(1, 100)
    upto = 0
    for quality in QUALITIES:
        upto += quality.share_pct
        if roll <= upto:
            return quality
    return QUALITIES[-1]


def render_documents(
    documents: Sequence[SyntheticDocument], seed: int
) -> tuple[RenderedDocument, ...]:
    """Lay out and damage every document. The same seed gives the same text."""
    if sum(q.share_pct for q in QUALITIES) != 100:
        raise ValueError("quality shares must sum to 100")
    rng = random.Random(seed)
    out: list[RenderedDocument] = []
    for doc in documents:
        layout = LAYOUTS[rng.randint(0, len(LAYOUTS) - 1)]
        quality = _pick_quality(rng)
        lines = damage(clean_lines(doc, layout, rng), quality, rng)
        out.append(
            RenderedDocument(doc.doc_id, doc.doc_type, layout, quality.name, "\n".join(lines))
        )
    return tuple(out)
