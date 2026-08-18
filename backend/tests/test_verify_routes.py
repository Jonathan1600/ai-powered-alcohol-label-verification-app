"""The verify endpoint, covered offline.

Every test here runs against `MockLabelReader` through a dependency override, so
the suite still needs no API key and no network. That is not a convenience: the
boundary behaviour below (what is rejected, what status a failure maps to, what
the timings claim) is exactly the part that must not drift, and tying it to a
live model would make it drift with the weather.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.matching.contracts import ExtractedLabel, OverallStatus, Readability, UnreadableReason
from app.readers.openai_reader import ExtractionError
from app.verify.routes import get_reader
from tests.conftest import field

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake image payload"


@pytest.fixture
def client(application, extraction):
    """A client whose reader always returns the clean extraction."""
    app.dependency_overrides[get_reader] = lambda: _StubReader(extraction)
    yield TestClient(app), application
    app.dependency_overrides.clear()


class _StubReader:
    def __init__(self, reading: ExtractedLabel | Exception) -> None:
        self._reading = reading

    def read(self, image: bytes) -> ExtractedLabel:
        if isinstance(self._reading, Exception):
            raise self._reading
        return self._reading


def post(client: TestClient, application, image: bytes = PNG_BYTES, content_type="image/png"):
    return client.post(
        "/api/verify",
        files={"image": ("label.png", image, content_type)},
        data={"application": application.model_dump_json()},
    )


def test_a_matching_label_verifies_clean(client):
    api, application = client
    response = post(api, application)
    assert response.status_code == 200
    assert response.json()["result"]["status"] == OverallStatus.LOOKS_CORRECT.value


def test_the_response_carries_every_stage_timing(client):
    api, application = client
    timings = post(api, application).json()["timings"]
    assert set(timings) == {"read_ms", "model_ms", "matching_ms", "server_total_ms"}
    assert all(value >= 0 for value in timings.values())
    # The engine is local computation and the budget in approach.md section 6
    # allots it under 50ms. If this ever fails, the engine grew a network call.
    assert timings["matching_ms"] < 50


def test_the_response_attributes_the_model_and_prompt(client):
    api, application = client
    body = post(api, application).json()
    assert body["model"]
    assert body["prompt_version"]
    assert body["image_bytes"] == len(PNG_BYTES)


def test_a_mismatch_is_reported_rather_than_hidden(client, application, extraction):
    api, _ = client
    extraction.brand_name = field("Something Else Entirely")
    app.dependency_overrides[get_reader] = lambda: _StubReader(extraction)
    body = post(api, application).json()
    assert body["result"]["status"] == OverallStatus.PROBLEM_FOUND.value


def test_an_unreadable_label_is_a_result_not_an_error(client, application):
    """200, not 4xx. The agent asked a question and got a real answer."""
    api, _ = client
    unreadable = ExtractedLabel(
        readability=Readability(unreadable=True, reason=UnreadableReason.GLARE)
    )
    app.dependency_overrides[get_reader] = lambda: _StubReader(unreadable)
    response = post(api, application)
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["status"] == OverallStatus.UNREADABLE.value
    assert body["result"]["unreadable_reason"] == UnreadableReason.GLARE.value


def test_an_extraction_failure_is_a_bad_gateway(client, application):
    """502 keeps 'the provider broke' distinct from 'the photo is bad'."""
    api, _ = client
    app.dependency_overrides[get_reader] = lambda: _StubReader(ExtractionError("upstream down"))
    response = post(api, application)
    assert response.status_code == 502
    assert "upstream down" in response.json()["detail"]


def test_an_unsupported_image_type_is_refused(client, application):
    api, _ = client
    assert post(api, application, content_type="application/pdf").status_code == 415


def test_an_empty_upload_is_refused(client, application):
    api, _ = client
    assert post(api, application, image=b"").status_code == 422


def test_an_oversized_upload_is_refused(client, application):
    api, _ = client
    from app.verify.routes import MAX_IMAGE_BYTES

    oversized = b"\x89PNG\r\n\x1a\n" + b"x" * MAX_IMAGE_BYTES
    assert post(api, application, image=oversized).status_code == 413


def test_malformed_application_json_is_refused(client):
    api, _ = client
    response = api.post(
        "/api/verify",
        files={"image": ("label.png", PNG_BYTES, "image/png")},
        data={"application": "not json at all"},
    )
    assert response.status_code == 422


def test_an_incomplete_application_record_is_refused(client):
    api, _ = client
    response = api.post(
        "/api/verify",
        files={"image": ("label.png", PNG_BYTES, "image/png")},
        data={"application": json.dumps({"brand_name": "Only This"})},
    )
    assert response.status_code == 422
