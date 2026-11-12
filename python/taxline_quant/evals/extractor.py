"""A simulated field extractor with a known error and confidence model.

The real extractor is the rules extractor in ``service/src/extract``, scored
through ``rules.py``. This stand-in is kept for two jobs the real one cannot do:
it exercises the scoring code with errors whose rate is known in advance, and it
shows what a miscalibrated reader costs, because its two profiles make the same
mistakes and differ only in the confidence they state. No model API is called.

Each field falls in a legibility tier. The tier fixes the chance the value is
read correctly; the profile decides how the reported confidence relates to it.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from .documents import FieldKind, SyntheticDocument, TruthField


@dataclass(frozen=True, slots=True)
class Prediction:
    """One extracted field, in the service's ``ExtractedField`` terms."""

    doc_id: str
    label: str
    value: str | None
    """``None`` when the extractor declines to read the field."""
    confidence: float | None


@dataclass(frozen=True, slots=True)
class Tier:
    name: str
    share_pct: int
    """Percent of fields that land in this tier."""
    accuracy_pct: int
    """Percent of fields in this tier that are read correctly."""
    abstain_pct: int


@dataclass(frozen=True, slots=True)
class ExtractorProfile:
    name: str
    description: str
    tiers: tuple[Tier, ...]
    inflation_pct: int
    """How far reported confidence is pulled from the true accuracy toward 1.0,
    as a percent of the gap. 0 is calibrated."""
    noise_pct: int
    """Half-width of uniform noise on the reported confidence, in points."""
    hallucination_per_mille: int
    """Chance, per document, of emitting a field the document does not have."""


_TIERS: Final = (
    Tier("clean", share_pct=70, accuracy_pct=99, abstain_pct=0),
    Tier("smudged", share_pct=22, accuracy_pct=86, abstain_pct=2),
    Tier("poor", share_pct=8, accuracy_pct=55, abstain_pct=25),
)

CALIBRATED: Final = ExtractorProfile(
    name="calibrated",
    description="Reported confidence tracks the true chance of being right.",
    tiers=_TIERS,
    inflation_pct=0,
    noise_pct=4,
    hallucination_per_mille=10,
)
OVERCONFIDENT: Final = ExtractorProfile(
    name="overconfident",
    description="Reported confidence is pulled 70% of the way toward 1.0.",
    tiers=_TIERS,
    inflation_pct=70,
    noise_pct=4,
    hallucination_per_mille=10,
)
PROFILES: Final = {p.name: p for p in (CALIBRATED, OVERCONFIDENT)}

_HALLUCINATED_LABEL: Final = "Other income · box 3"


def _pick_tier(rng: random.Random, tiers: Sequence[Tier]) -> Tier:
    roll = rng.randint(1, 100)
    upto = 0
    for tier in tiers:
        upto += tier.share_pct
        if roll <= upto:
            return tier
    return tiers[-1]


def _corrupt_digits(rng: random.Random, value: str) -> str:
    """Change one digit, the way a misread character would."""
    positions = [i for i, ch in enumerate(value) if ch.isdigit()]
    if not positions:
        return value + "?"
    i = rng.choice(positions)
    replacement = str((int(value[i]) + rng.randint(1, 9)) % 10)
    return value[:i] + replacement + value[i + 1 :]


def _corrupt(rng: random.Random, field: TruthField) -> str:
    if field.kind is FieldKind.TEXT:
        # Drop the last word or character: a truncated read.
        head, _, _ = field.value.rpartition(" ")
        return head or field.value[:-1] or "?"
    return _corrupt_digits(rng, field.value)


def _confidence(rng: random.Random, tier: Tier, profile: ExtractorProfile) -> float:
    inflated = tier.accuracy_pct + (100 - tier.accuracy_pct) * profile.inflation_pct // 100
    noisy = inflated + rng.randint(-profile.noise_pct, profile.noise_pct)
    return min(100, max(1, noisy)) / 100


def simulate_extraction(
    documents: Sequence[SyntheticDocument],
    profile: ExtractorProfile,
    seed: int,
) -> tuple[Prediction, ...]:
    """Run the simulated extractor over ``documents``. Integer draws only."""
    if sum(t.share_pct for t in profile.tiers) != 100:
        raise ValueError("tier shares must sum to 100")
    rng = random.Random(seed)
    out: list[Prediction] = []
    for doc in documents:
        for field in doc.fields:
            tier = _pick_tier(rng, profile.tiers)
            if rng.randint(1, 100) <= tier.abstain_pct:
                out.append(Prediction(doc.doc_id, field.label, None, None))
                continue
            correct = rng.randint(1, 100) <= tier.accuracy_pct
            value = field.value if correct else _corrupt(rng, field)
            out.append(Prediction(doc.doc_id, field.label, value, _confidence(rng, tier, profile)))
        if rng.randint(1, 1000) <= profile.hallucination_per_mille:
            poor = profile.tiers[-1]
            out.append(
                Prediction(
                    doc.doc_id,
                    _HALLUCINATED_LABEL,
                    "$1,000.00",
                    _confidence(rng, poor, profile),
                )
            )
    return tuple(out)
