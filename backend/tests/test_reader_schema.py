"""The wire schema and its mapping onto the contract.

Pure functions over data, so this runs offline and covers the one piece of
translation the reader does that is not a straight copy: turning an observed
cap-height ratio into the millimetres the warning check expects.
"""

import pytest

from app.matching.contracts import UnreadableReason
from app.readers.openai_reader import ExtractionError, sniff_mime
from app.readers.schema import (
    ASSUMED_LABEL_HEIGHT_MM,
    LabelObservation,
    ObservedField,
    ObservedReadability,
    ObservedWarning,
    to_contract,
)


def observation(**overrides) -> LabelObservation:
    """A complete clean reading, before overrides."""
    defaults = {
        "readability": ObservedReadability(unreadable=False, reason=None, notes=None),
        "brand_name": ObservedField(verbatim="Stone's Throw", confidence=0.99),
        "class_type": ObservedField(verbatim="Kentucky Straight Bourbon Whiskey", confidence=0.99),
        "alcohol_content": ObservedField(verbatim="45% Alc./Vol. (90 Proof)", confidence=0.99),
        "net_contents": ObservedField(verbatim="750 mL", confidence=0.99),
        "bottler_info": ObservedField(verbatim="Bottled by Stone's Throw", confidence=0.99),
        "country_of_origin": ObservedField(verbatim=None, confidence=0.95),
        "government_warning": ObservedWarning(
            present=True,
            verbatim="GOVERNMENT WARNING: ...",
            prefix_is_caps=True,
            prefix_is_bold=True,
            remainder_is_bold=False,
            cap_height_ratio=0.02,
            confidence=0.98,
        ),
    }
    return LabelObservation(**{**defaults, **overrides})


def test_the_ratio_becomes_millimetres():
    label = to_contract(observation())
    assert label.government_warning.estimated_type_size_mm == pytest.approx(
        0.02 * ASSUMED_LABEL_HEIGHT_MM
    )


def test_the_fixture_ratio_reproduces_the_rendered_type_size():
    """The corpus renders its warning at 2.2mm on a 120mm label, so 22px of 1200."""
    label = to_contract(
        observation(
            government_warning=ObservedWarning(
                present=True,
                verbatim="GOVERNMENT WARNING: ...",
                prefix_is_caps=True,
                prefix_is_bold=True,
                remainder_is_bold=False,
                cap_height_ratio=22 / 1200,
                confidence=1.0,
            )
        )
    )
    assert label.government_warning.estimated_type_size_mm == pytest.approx(2.2)


def test_an_unjudged_ratio_stays_unknown():
    """None must survive as None. The warning check grades it to needs review."""
    label = to_contract(
        observation(
            government_warning=ObservedWarning(
                present=True,
                verbatim="GOVERNMENT WARNING: ...",
                prefix_is_caps=True,
                prefix_is_bold=True,
                remainder_is_bold=None,
                cap_height_ratio=None,
                confidence=0.9,
            )
        )
    )
    assert label.government_warning.estimated_type_size_mm is None
    assert label.government_warning.remainder_is_bold is None


def test_confidence_out_of_range_is_clamped_rather_than_raising():
    """A model returning 1.4 should not cost the whole call."""
    label = to_contract(observation(brand_name=ObservedField(verbatim="X", confidence=1.4)))
    assert label.brand_name.confidence == 1.0


def test_a_readable_label_carries_no_unreadable_reason():
    """A stray reason on a readable label is noise and is dropped."""
    label = to_contract(
        observation(
            readability=ObservedReadability(
                unreadable=False, reason=UnreadableReason.GLARE, notes="some glare"
            )
        )
    )
    assert not label.readability.unreadable
    assert label.readability.reason is None


def test_an_unreadable_label_keeps_its_reason():
    label = to_contract(
        observation(
            readability=ObservedReadability(
                unreadable=True, reason=UnreadableReason.BLUR, notes="heavy motion blur"
            )
        )
    )
    assert label.readability.unreadable
    assert label.readability.reason is UnreadableReason.BLUR
    assert label.readability.notes == "heavy motion blur"


def test_an_absent_field_stays_absent():
    assert to_contract(observation()).country_of_origin.verbatim is None


@pytest.mark.parametrize(
    ("magic", "expected"),
    [
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff\xe0", "image/jpeg"),
        (b"RIFF____WEBP", "image/webp"),
    ],
)
def test_mime_is_read_from_the_bytes(magic, expected):
    assert sniff_mime(magic + b"payload") == expected


def test_an_unrecognised_format_raises():
    with pytest.raises(ExtractionError):
        sniff_mime(b"GIF89a not supported")
