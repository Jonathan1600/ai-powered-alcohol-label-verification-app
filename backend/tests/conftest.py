"""Builders for the matching tests.

Each test says only what it is actually about; everything else defaults to a
clean, compliant label so a failure points at one thing.
"""

import pytest

from app.matching.contracts import (
    ApplicationRecord,
    BeverageClass,
    ExtractedField,
    ExtractedLabel,
    Readability,
    WarningBlock,
)
from app.matching.warning import CANONICAL_WARNING


def field(verbatim: str | None, confidence: float = 1.0) -> ExtractedField:
    return ExtractedField(verbatim=verbatim, confidence=confidence)


def compliant_warning(**overrides) -> WarningBlock:
    """A warning block that passes every check, before overrides."""
    defaults = {
        "present": True,
        "verbatim": CANONICAL_WARNING,
        "prefix_is_caps": True,
        "prefix_is_bold": True,
        "remainder_is_bold": False,
        "estimated_type_size_mm": 2.0,
        "confidence": 1.0,
    }
    return WarningBlock(**{**defaults, **overrides})


@pytest.fixture
def application() -> ApplicationRecord:
    return ApplicationRecord(
        brand_name="Stone's Throw",
        class_type="Kentucky Straight Bourbon Whiskey",
        alcohol_content="45% Alc./Vol. (90 Proof)",
        net_contents="750 mL",
        bottler_info="Bottled by Stone's Throw Distillery, 120 Main St, Bardstown, KY",
        beverage_class=BeverageClass.DISTILLED_SPIRITS,
        is_import=False,
    )


@pytest.fixture
def extraction() -> ExtractedLabel:
    return ExtractedLabel(
        readability=Readability(unreadable=False),
        brand_name=field("Stone's Throw"),
        class_type=field("Kentucky Straight Bourbon Whiskey"),
        alcohol_content=field("45% Alc./Vol. (90 Proof)"),
        net_contents=field("750 mL"),
        bottler_info=field("Bottled by Stone's Throw Distillery, 120 Main St, Bardstown, KY"),
        country_of_origin=field(None),
        government_warning=compliant_warning(),
    )
