"""Numeric parsing and regulatory tolerance bands.

Alcohol content and net contents are never string-compared. `45% Alc./Vol.
(90 Proof)` and `45.0% alcohol by volume` are the same claim written two ways,
and only a parse to a number can see that.

A note on what the CFR tolerances mean here. As written, they bound the
difference between the *labeled* alcohol content and the *actual* contents of
the bottle. This engine compares the application form against the label, which
is a different pair. They are used as the boundary between "the paperwork
disagrees with the label, but the label would still be lawful for this product"
(needs review) and "the paperwork and the label disagree beyond anything the
regulation would forgive" (mismatch). An exact agreement is the only outcome
that passes clean.
"""

import re
from dataclasses import dataclass
from enum import Enum

from app.matching.contracts import BeverageClass

# 27 CFR 4.36(b)(1): wine at 14% alcohol by volume or less, plus or minus 1.5
# percentage points. Over 14%, plus or minus 1.0.
_WINE_LOW_TOLERANCE = 1.5
_WINE_HIGH_TOLERANCE = 1.0

# 27 CFR 4.36(b)(2): a tolerance may not be used to bridge this boundary,
# because it separates two taxable grades.
_WINE_TAX_CLASS_BOUNDARY = 14.0

# 27 CFR 5.65(a)(2): distilled spirits, plus or minus 0.3 percentage points.
_SPIRITS_TOLERANCE = 0.3

# 27 CFR 7.65(b)(2): malt beverages, plus or minus 0.3 percentage points, for
# products containing 0.5% alcohol by volume or more. Below that, none.
_MALT_TOLERANCE = 0.3
_MALT_TOLERANCE_FLOOR = 0.5

# Net contents is a declaration, not a measurement, so the only slack allowed is
# what rounding between millilitres and fluid ounces introduces.
_NET_CONTENTS_RELATIVE_TOLERANCE = 0.005

_FLOAT = r"\d+(?:\.\d+)?"
_PERCENT = re.compile(rf"({_FLOAT})\s*(?:%|percent|per cent)", re.IGNORECASE)
_PERCENT_TRAILING = re.compile(
    rf"(?:alcohol|alc)\.?\s*(?:by\s*vol(?:ume)?\.?)?\s*({_FLOAT})", re.IGNORECASE
)
_PROOF = re.compile(rf"({_FLOAT})\s*proof", re.IGNORECASE)

# Every unit expressed in millilitres. US customary, per 27 CFR fill standards.
_VOLUME_UNITS = {
    "ml": 1.0,
    "milliliter": 1.0,
    "milliliters": 1.0,
    "millilitre": 1.0,
    "millilitres": 1.0,
    "cl": 10.0,
    "centiliter": 10.0,
    "centiliters": 10.0,
    "l": 1000.0,
    "liter": 1000.0,
    "liters": 1000.0,
    "litre": 1000.0,
    "litres": 1000.0,
    "floz": 29.5735295625,
    "fluidounce": 29.5735295625,
    "fluidounces": 29.5735295625,
    "oz": 29.5735295625,
    "ounce": 29.5735295625,
    "ounces": 29.5735295625,
    "pint": 473.176473,
    "pints": 473.176473,
    "quart": 946.352946,
    "quarts": 946.352946,
    "gallon": 3785.411784,
    "gallons": 3785.411784,
}

_VOLUME = re.compile(
    rf"({_FLOAT})\s*(fl\.?\s*oz|fluid\s+ounces?|milliliters?|millilitres?|centiliters?"
    rf"|liters?|litres?|ounces?|pints?|quarts?|gallons?|ml|cl|oz|l)\b",
    re.IGNORECASE,
)

# A parenthesized quantity restates the declaration in a second unit, as in
# `750 mL (25.4 fl oz)`. It is the same volume said twice, never an addition.
_PARENTHETICAL = re.compile(r"\([^)]*\)")


class Comparison(str, Enum):
    """What the numbers say, before anything decides what it means."""

    EQUAL = "equal"
    WITHIN_TOLERANCE = "within_tolerance"
    OUT_OF_TOLERANCE = "out_of_tolerance"
    CROSSES_TAX_CLASS = "crosses_tax_class"
    UNPARSEABLE = "unparseable"


@dataclass(frozen=True)
class AlcoholContent:
    """A parsed alcohol statement. `proof` is None when the label omits it."""

    abv: float
    proof: float | None = None

    @property
    def proof_is_consistent(self) -> bool:
        """Proof is twice ABV by definition, so a label stating both must agree.

        A tenth of a point of slack absorbs a label that rounds one of the two.
        """
        if self.proof is None:
            return True
        return abs(self.proof - self.abv * 2) <= 0.1


@dataclass(frozen=True)
class Volume:
    """A parsed net contents statement, carried in millilitres."""

    milliliters: float
    original_unit: str


def parse_alcohol_content(text: str | None) -> AlcoholContent | None:
    """Pull ABV and optional proof out of a free-form alcohol statement.

    Falls back to deriving ABV from proof when only proof is stated, which some
    spirits labels do.
    """
    if not text:
        return None

    proof_match = _PROOF.search(text)
    proof = float(proof_match.group(1)) if proof_match else None

    # Strip the proof clause before hunting for a percentage, so that a bare
    # "90 Proof" cannot be misread as 90% alcohol by volume.
    without_proof = _PROOF.sub(" ", text)

    percent_match = _PERCENT.search(without_proof) or _PERCENT_TRAILING.search(without_proof)
    if percent_match:
        return AlcoholContent(abv=float(percent_match.group(1)), proof=proof)

    if proof is not None:
        return AlcoholContent(abv=proof / 2, proof=proof)

    return None


def _volume_parts(text: str) -> list[tuple[float, str, str]]:
    """Every quantity and unit in the text, converted to millilitres."""
    parts = []
    for match in _VOLUME.finditer(text):
        unit_key = re.sub(r"[\s.]", "", match.group(2)).lower()
        factor = _VOLUME_UNITS.get(unit_key)
        if factor is None:
            continue
        parts.append((float(match.group(1)) * factor, match.group(2).strip(), unit_key))
    return parts


def parse_volume(text: str | None) -> Volume | None:
    """Pull a net contents declaration out of free-form text.

    US labels write a compound declaration as `1 PINT 8 FL. OZ.`, which is one
    volume in two units and has to be summed. That form is told apart from a
    restatement by shape: the parts of a compound descend in size and never
    repeat a unit, so `750 mL 25.4 fl oz` stops after the first part while
    `1 PINT 8 FL OZ` adds them.
    """
    if not text:
        return None

    parts = _volume_parts(_PARENTHETICAL.sub(" ", text)) or _volume_parts(text)
    if not parts:
        return None

    total, original_unit, previous_key = parts[0]
    previous_milliliters = total
    for milliliters, _unit, unit_key in parts[1:]:
        if milliliters >= previous_milliliters or unit_key == previous_key:
            break
        total += milliliters
        previous_milliliters = milliliters
        previous_key = unit_key

    return Volume(milliliters=total, original_unit=original_unit)


def abv_tolerance(beverage_class: BeverageClass, abv: float) -> float:
    """The permitted variance in percentage points for this class and strength."""
    if beverage_class is BeverageClass.WINE:
        return _WINE_LOW_TOLERANCE if abv <= _WINE_TAX_CLASS_BOUNDARY else _WINE_HIGH_TOLERANCE
    if beverage_class is BeverageClass.MALT_BEVERAGE:
        return _MALT_TOLERANCE if abv >= _MALT_TOLERANCE_FLOOR else 0.0
    return _SPIRITS_TOLERANCE


def compare_alcohol_content(
    claimed: AlcoholContent | None,
    extracted: AlcoholContent | None,
    beverage_class: BeverageClass,
) -> tuple[Comparison, float]:
    """Compare two alcohol statements. Returns the outcome and the gap in points."""
    if claimed is None or extracted is None:
        return Comparison.UNPARSEABLE, 0.0

    difference = abs(claimed.abv - extracted.abv)
    if difference == 0:
        return Comparison.EQUAL, 0.0

    if beverage_class is BeverageClass.WINE and _straddles_wine_boundary(
        claimed.abv, extracted.abv
    ):
        # 27 CFR 4.36(b)(2). The two values fall in different taxable grades, so
        # no tolerance is available however small the gap.
        return Comparison.CROSSES_TAX_CLASS, difference

    tolerance = abv_tolerance(beverage_class, min(claimed.abv, extracted.abv))
    if difference <= tolerance:
        return Comparison.WITHIN_TOLERANCE, difference
    return Comparison.OUT_OF_TOLERANCE, difference


def _straddles_wine_boundary(first: float, second: float) -> bool:
    return (first <= _WINE_TAX_CLASS_BOUNDARY) != (second <= _WINE_TAX_CLASS_BOUNDARY)


def compare_volume(claimed: Volume | None, extracted: Volume | None) -> Comparison:
    """Compare two net contents declarations after conversion to millilitres."""
    if claimed is None or extracted is None:
        return Comparison.UNPARSEABLE
    if claimed.milliliters == extracted.milliliters:
        return Comparison.EQUAL

    larger = max(claimed.milliliters, extracted.milliliters)
    if larger == 0:
        return Comparison.EQUAL
    relative = abs(claimed.milliliters - extracted.milliliters) / larger
    if relative <= _NET_CONTENTS_RELATIVE_TOLERANCE:
        # Same declared volume, written in different units.
        return Comparison.EQUAL
    return Comparison.OUT_OF_TOLERANCE
