"""The LabelReader seam. Thin by design; its value is that it exists (ADR-002)."""

import pytest

from app.matching import verify
from app.matching.contracts import ExtractedLabel, OverallStatus, Readability, UnreadableReason
from app.readers import LabelReader
from app.readers.mock import MockLabelReader
from tests.conftest import field


def test_mock_satisfies_the_protocol(extraction):
    assert isinstance(MockLabelReader(default=extraction), LabelReader)


def test_mock_returns_the_registered_reading(extraction):
    reader = MockLabelReader(default=extraction)
    assert reader.read(b"any-image").brand_name.verbatim == "Stone's Throw"


def test_mock_is_deterministic(extraction):
    reader = MockLabelReader(default=extraction)
    assert reader.read(b"image").model_dump() == reader.read(b"image").model_dump()


def test_mock_serves_different_readings_per_image(extraction):
    unreadable = ExtractedLabel(
        readability=Readability(unreadable=True, reason=UnreadableReason.BLUR)
    )
    reader = MockLabelReader(default=extraction, by_image={b"blurry": unreadable})
    assert reader.read(b"blurry").readability.unreadable
    assert not reader.read(b"sharp").readability.unreadable


def test_mock_records_calls(extraction):
    reader = MockLabelReader(default=extraction)
    reader.read(b"one")
    reader.read(b"two")
    assert reader.calls == [b"one", b"two"]


def test_mutating_a_reading_cannot_corrupt_later_reads(extraction):
    reader = MockLabelReader(default=extraction)
    reader.read(b"image").brand_name.verbatim = "Tampered"
    assert reader.read(b"image").brand_name.verbatim == "Stone's Throw"


def test_mock_requires_something_to_serve():
    with pytest.raises(ValueError):
        MockLabelReader()


def test_reader_and_engine_compose(application, extraction):
    """The phase 4 shape, exercised now with no network in the path."""
    extraction.brand_name = field("STONE’S THROW")
    reader = MockLabelReader(default=extraction)
    assert verify(application, reader.read(b"label.jpg")).status is OverallStatus.LOOKS_CORRECT
