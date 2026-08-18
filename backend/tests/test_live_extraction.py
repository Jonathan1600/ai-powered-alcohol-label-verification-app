"""End-to-end extraction against the real model. Opt-in, and costs money.

Deselected by default through the `live` marker, so `uv run pytest` stays
offline and keyless. Run these with `uv run pytest -m live`.

These are not accuracy measurements. Scoring the corpus is phase 8's job and it
reports numbers rather than passing or failing per label. What is asserted here
is the small set of properties that must hold for the pipeline to mean anything
at all, chosen so that a failure names a specific broken thing rather than
"the model got worse".

The load-bearing one is `test_an_altered_warning_is_not_repaired`. A model that
quietly corrects a misworded warning toward the statutory text would make every
warning fixture pass for the wrong reason and hollow out the strict path in
`app.matching.warning` without failing a single offline test.
"""

import os
import time

import pytest

from app.config import get_settings
from app.matching import verify
from app.matching.contracts import OverallStatus
from app.matching.warning import CANONICAL_WARNING
from app.readers.openai_reader import build_reader
from app.seed.loader import FIXTURE_DIR, load_manifest

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.environ.get("OPENAI_API_KEY"),
        reason="live extraction needs OPENAI_API_KEY",
    ),
]


@pytest.fixture(scope="module")
def reader():
    return build_reader(get_settings())


@pytest.fixture(scope="module")
def fixtures():
    return {item.id: item for item in load_manifest().items}


def read(reader, fixtures, fixture_id):
    """Read one fixture image, returning it alongside its manifest entry."""
    fixture = fixtures[fixture_id]
    return fixture, reader.read((FIXTURE_DIR / fixture.image).read_bytes())


def normalize(text: str | None) -> str:
    return " ".join((text or "").split())


def test_a_clean_label_verifies_clean(reader, fixtures):
    fixture, extraction = read(reader, fixtures, "clean-bourbon-750")
    assert verify(fixture.application, extraction).status is OverallStatus.LOOKS_CORRECT


def test_the_named_requirement_passes(reader, fixtures):
    """All-caps plus a curly apostrophe must not fail. This is the brief's case."""
    fixture, extraction = read(reader, fixtures, "case-variance")
    assert verify(fixture.application, extraction).status is OverallStatus.LOOKS_CORRECT


def test_an_altered_warning_is_not_repaired(reader, fixtures):
    """The single most important live assertion in the project.

    The label carries a warning whose wording has been changed. The model must
    transcribe the change rather than completing the statutory text from memory.
    """
    fixture, extraction = read(reader, fixtures, "warning-altered-wording")
    transcribed = normalize(extraction.government_warning.verbatim)

    assert transcribed, "the warning was not transcribed at all"
    assert transcribed != normalize(CANONICAL_WARNING), (
        "the model returned the statutory text for a label that does not carry it, "
        "which defeats the entire government warning check"
    )
    assert verify(fixture.application, extraction).status is OverallStatus.PROBLEM_FOUND


def test_a_title_case_warning_is_caught(reader, fixtures):
    """Wording matches, capitalisation does not. Derived from the transcription."""
    fixture, extraction = read(reader, fixtures, "warning-title-case")
    assert verify(fixture.application, extraction).status is OverallStatus.PROBLEM_FOUND


def test_a_missing_warning_is_caught(reader, fixtures):
    fixture, extraction = read(reader, fixtures, "warning-missing")
    assert verify(fixture.application, extraction).status is OverallStatus.PROBLEM_FOUND


def test_a_mismatched_brand_is_caught(reader, fixtures):
    fixture, extraction = read(reader, fixtures, "brand-name-mismatch")
    assert verify(fixture.application, extraction).status is OverallStatus.PROBLEM_FOUND


def test_a_blurred_label_is_reported_unreadable(reader, fixtures):
    """Unreadable is a distinct outcome, never a confident guess. See ADR-003."""
    fixture, extraction = read(reader, fixtures, "unreadable-blur")
    assert extraction.readability.unreadable
    assert verify(fixture.application, extraction).status is OverallStatus.UNREADABLE


def test_the_type_size_is_estimated_at_all(reader, fixtures):
    """The ratio must come back as a number in the right order of magnitude.

    Not an accuracy assertion. Phase 4 measured the estimate running high, by up
    to 50% against a known 2.2mm rendering, and assumptions.md carries that as an
    open calibration item. What this guards is the wiring: a None here means the
    model stopped answering the ratio question and every warning silently drops
    to needs review.
    """
    _, extraction = read(reader, fixtures, "clean-bourbon-750")
    estimated = extraction.government_warning.estimated_type_size_mm
    assert estimated is not None
    assert 0.5 < estimated < 10.0


def test_extraction_stays_within_the_timeout(reader, fixtures):
    """A loose ceiling, not the 5 second requirement.

    The real budget is enforced by the phase 8 evaluation script across the whole
    corpus at p95, because a single call is far too noisy to gate on: phase 4
    measured the same request taking anywhere from 3.0 to 20.4 seconds. This only
    catches a hang.
    """
    started = time.perf_counter()
    read(reader, fixtures, "clean-gin-750")
    assert (time.perf_counter() - started) < 30.0
