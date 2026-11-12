"""Synthetic tax documents with known ground truth.

Every document is generated from a seed with integer draws only, so the same
seed gives the same documents on every platform. Nothing here is real: company
names are assembled from word lists and every taxpayer ID uses the ``00-``
prefix, which the IRS does not assign.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Final


class FieldKind(StrEnum):
    MONEY = "money"
    ID = "id"
    TEXT = "text"


@dataclass(frozen=True, slots=True)
class TruthField:
    label: str
    value: str
    kind: FieldKind


@dataclass(frozen=True, slots=True)
class SyntheticDocument:
    doc_id: str
    doc_type: str
    fields: tuple[TruthField, ...]

    def field(self, label: str) -> TruthField | None:
        return next((f for f in self.fields if f.label == label), None)

    def text(self) -> str:
        """The document as plain text, the way an extractor would receive it."""
        lines = [f"{self.doc_type} (synthetic, {self.doc_id})"]
        lines += [f"{f.label}: {f.value}" for f in self.fields]
        return "\n".join(lines)


_FIRST: Final = (
    "Juniper",
    "Harbor",
    "Copper",
    "Meadow",
    "Granite",
    "Lantern",
    "Orchard",
    "Summit",
    "Willow",
    "Beacon",
    "Cedar",
    "Marble",
)
_SECOND: Final = (
    "Works",
    "Studios",
    "Supply",
    "Partners",
    "Logistics",
    "Design",
    "Foods",
    "Labs",
    "Outfitters",
    "Press",
)
_SUFFIX: Final = ("LLC", "Inc.", "LP", "Co.")
_LOCAL_CODES: Final = ("PHL-RES", "PHL-NR", "NYC-RES", "CLE-RES", "COL-NR", "DET-RES")

# Labels match the service's intake queue (service/src/seed/queue.ts) so a
# recorded extract_fields result can be scored without a mapping step.
W2: Final = "W-2"
NEC: Final = "1099-NEC"
INT: Final = "1099-INT"
DOC_TYPES: Final = (W2, NEC, INT)
_CENT: Final = Decimal("0.01")


def format_money(amount: Decimal) -> str:
    return f"${amount:,.2f}"


def _money(rng: random.Random, low: int, high: int) -> Decimal:
    return Decimal(rng.randint(low * 100, high * 100)) / 100


def _name(rng: random.Random) -> str:
    return f"{rng.choice(_FIRST)} {rng.choice(_SECOND)} {rng.choice(_SUFFIX)}"


def _tin(rng: random.Random) -> str:
    return f"00-{rng.randint(0, 9_999_999):07d}"


def _w2(rng: random.Random) -> tuple[TruthField, ...]:
    wages = _money(rng, 18_000, 240_000)
    federal = (wages * rng.randint(8, 24) / 100).quantize(_CENT)
    state = (wages * rng.randint(2, 7) / 100).quantize(_CENT)
    return (
        TruthField("Employer", _name(rng), FieldKind.TEXT),
        TruthField("EIN", _tin(rng), FieldKind.ID),
        TruthField("Wages · box 1", format_money(wages), FieldKind.MONEY),
        TruthField("Federal w/h · box 2", format_money(federal), FieldKind.MONEY),
        TruthField("State w/h · box 17", format_money(state), FieldKind.MONEY),
        TruthField("Local code · box 20", rng.choice(_LOCAL_CODES), FieldKind.TEXT),
    )


def _nec(rng: random.Random) -> tuple[TruthField, ...]:
    comp = _money(rng, 600, 180_000)
    backup = rng.randint(1, 10) == 1
    withheld = (comp * 24 / 100).quantize(_CENT) if backup else Decimal(0)
    return (
        TruthField("Payer", _name(rng), FieldKind.TEXT),
        TruthField("Payer TIN", _tin(rng), FieldKind.ID),
        TruthField("Nonemployee comp · box 1", format_money(comp), FieldKind.MONEY),
        TruthField("Federal w/h · box 4", format_money(withheld), FieldKind.MONEY),
    )


def _int(rng: random.Random) -> tuple[TruthField, ...]:
    interest = _money(rng, 10, 9_000)
    penalty = _money(rng, 0, 150)
    return (
        TruthField("Payer", _name(rng), FieldKind.TEXT),
        TruthField("Payer TIN", _tin(rng), FieldKind.ID),
        TruthField("Interest income · box 1", format_money(interest), FieldKind.MONEY),
        TruthField("Early withdrawal penalty · box 2", format_money(penalty), FieldKind.MONEY),
    )


_BUILDERS: Final = {W2: _w2, NEC: _nec, INT: _int}


def generate_documents(seed: int, count: int) -> tuple[SyntheticDocument, ...]:
    """``count`` synthetic documents, cycling through the three form types."""
    if count < 0:
        raise ValueError("count cannot be negative")
    rng = random.Random(seed)
    docs: list[SyntheticDocument] = []
    for n in range(count):
        doc_type = DOC_TYPES[n % len(DOC_TYPES)]
        slug = doc_type.lower().replace("-", "")
        fields = _BUILDERS[doc_type](rng)
        docs.append(SyntheticDocument(f"syn-{seed}-{n:04d}-{slug}", doc_type, fields))
    return tuple(docs)
