"""The LabelReader seam. Thin by design; its value is that it exists (ADR-002)."""

from types import SimpleNamespace

import pytest

from app.config import DEFAULT_OPENAI_MODEL, DEFAULT_OPENAI_REASONING_EFFORT, Settings
from app.matching import verify
from app.matching.contracts import ExtractedLabel, OverallStatus, Readability, UnreadableReason
from app.readers import LabelReader
from app.readers.mock import MockLabelReader
from app.readers.openai_reader import ExtractionError, OpenAILabelReader, build_reader
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


def test_openai_reader_defaults_to_luna_with_low_reasoning() -> None:
    reader = OpenAILabelReader(client=object())

    assert reader._model == DEFAULT_OPENAI_MODEL
    assert reader._reasoning_effort == DEFAULT_OPENAI_REASONING_EFFORT


def test_reader_builder_applies_the_configured_model_and_reasoning(monkeypatch) -> None:
    settings = Settings(openai_model="test-model", openai_reasoning_effort="none")
    client = object()
    monkeypatch.setattr("app.readers.openai_reader._shared_client", lambda *_: client)
    reader = build_reader(settings)

    assert reader._client is client
    assert reader._model == "test-model"
    assert reader._reasoning_effort == "none"


def test_openai_reader_sends_the_configured_reasoning_effort() -> None:
    class RecordingResponses:
        def parse(self, **kwargs):
            self.kwargs = kwargs
            return SimpleNamespace(output_parsed=None, status="completed", incomplete_details=None)

    responses = RecordingResponses()
    reader = OpenAILabelReader(
        client=SimpleNamespace(responses=responses),
        reasoning_effort="low",
    )

    with pytest.raises(ExtractionError):
        reader.read(b"\x89PNG\r\n\x1a\n")

    assert responses.kwargs["reasoning"] == {"effort": "low"}
