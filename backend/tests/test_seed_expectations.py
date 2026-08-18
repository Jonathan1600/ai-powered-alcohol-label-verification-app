"""The engine, run against every fixture, checked against hand-authored answers.

This is the point of phase 3. `tools/fixtures/specs.py` states what each field
should be graded as and why, written by reading the regulation rather than by
running the code. Here that judgement meets the implementation.

A failure means one of the two is wrong, and the `note` on the expectation is
where to start: it says what the fixture was built to prove.
"""

import pytest

from app.matching.contracts import OverallStatus, Verdict
from app.matching.engine import verify
from app.seed.loader import load_manifest
from app.seed.models import SeedFixture

MANIFEST = load_manifest()
FIXTURES = MANIFEST.items
IDS = [fixture.id for fixture in FIXTURES]


@pytest.mark.parametrize("fixture", FIXTURES, ids=IDS)
def test_engine_returns_the_expected_status(fixture: SeedFixture) -> None:
    result = verify(fixture.application, fixture.ground_truth)
    assert result.status is fixture.expected.status, (
        f"{fixture.id}: expected {fixture.expected.status.value}, "
        f"got {result.status.value}. This fixture probes: {fixture.probes}"
    )


@pytest.mark.parametrize("fixture", FIXTURES, ids=IDS)
def test_engine_returns_the_expected_field_verdicts(fixture: SeedFixture) -> None:
    result = verify(fixture.application, fixture.ground_truth)

    actual = [(field.field, field.verdict) for field in result.fields]
    expected = [(field.field, field.verdict) for field in fixture.expected.fields]
    assert actual == expected, (
        f"{fixture.id}: field verdicts differ.\n"
        f"  expected {[(f.value, v.value) for f, v in expected]}\n"
        f"  got      {[(f.value, v.value) for f, v in actual]}\n"
        f"  probes:  {fixture.probes}"
    )


@pytest.mark.parametrize("fixture", FIXTURES, ids=IDS)
def test_every_field_carries_a_plain_english_reason(fixture: SeedFixture) -> None:
    """The reason string is the product, per approach.md section 3: the agent decides."""
    result = verify(fixture.application, fixture.ground_truth)
    for field in result.fields:
        assert field.reason.strip(), f"{fixture.id}: {field.field.value} came back with no reason"
        assert field.reason.strip().endswith("."), (
            f"{fixture.id}: {field.field.value} reason is not a sentence: {field.reason!r}"
        )


@pytest.mark.parametrize(
    "fixture",
    [f for f in FIXTURES if f.expected.status is OverallStatus.UNREADABLE],
    ids=[f.id for f in FIXTURES if f.expected.status is OverallStatus.UNREADABLE],
)
def test_unreadable_fixtures_return_no_field_verdicts(fixture: SeedFixture) -> None:
    """Approach.md section 5.4: unreadable is an outcome, never a low-confidence guess."""
    result = verify(fixture.application, fixture.ground_truth)
    assert result.fields == []
    assert result.unreadable_reason is fixture.expected.unreadable_reason


def test_the_warning_diff_is_emitted_when_wording_is_altered() -> None:
    """A wording failure has to show the agent what changed, not just that it did."""
    fixture = next(f for f in FIXTURES if f.id == "warning-altered-wording")
    result = verify(fixture.application, fixture.ground_truth)

    warning = next(field for field in result.fields if field.field.value == "government_warning")
    assert warning.verdict is Verdict.MISMATCH
    assert warning.diff, "an altered warning must carry a word-level diff"
    assert any("may" in operation.expected and "can" in operation.actual for operation in warning.diff)


def test_a_capitalization_failure_is_not_reported_as_a_wording_failure() -> None:
    """The title-case fixture exists to prove these two checks stay separate."""
    fixture = next(f for f in FIXTURES if f.id == "warning-title-case")
    result = verify(fixture.application, fixture.ground_truth)

    warning = next(field for field in result.fields if field.field.value == "government_warning")
    assert warning.verdict is Verdict.MISMATCH
    assert warning.diff is None, "a caps failure must not also produce a wording diff"
    assert "capital letters" in warning.reason
