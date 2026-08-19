"""The government warning strict path, one test per failure mode.

Order matters as much as the outcomes: a title-case warning must report as a
capitalization failure, not as a pile of wording changes.
"""

import pytest

from app.matching.contracts import Verdict, WarningBlock
from app.matching.quantities import parse_volume
from app.matching.warning import (
    CANONICAL_WARNING,
    check_government_warning,
    minimum_type_size_mm,
    word_diff,
)
from tests.conftest import compliant_warning


def test_canonical_text_matches_the_regulation():
    """27 CFR 16.21, verbatim. If this drifts, every other test is meaningless."""
    assert CANONICAL_WARNING == (
        "GOVERNMENT WARNING: (1) According to the Surgeon General, women should "
        "not drink alcoholic beverages during pregnancy because of the risk of "
        "birth defects. (2) Consumption of alcoholic beverages impairs your "
        "ability to drive a car or operate machinery, and may cause health "
        "problems."
    )


def test_compliant_warning_matches():
    assert check_government_warning(compliant_warning()).verdict is Verdict.MATCH


def test_line_breaks_in_the_warning_are_not_a_violation():
    """Labels wrap the warning across lines; that is layout, not wording."""
    wrapped = CANONICAL_WARNING.replace(" (2)", "\n(2)")
    assert check_government_warning(compliant_warning(verbatim=wrapped)).verdict is Verdict.MATCH


class TestHardFailures:
    def test_missing_warning_is_a_mismatch(self):
        result = check_government_warning(WarningBlock(present=False))
        assert result.verdict is Verdict.MISMATCH
        assert "does not appear" in result.reason

    def test_present_but_empty_is_a_mismatch(self):
        result = check_government_warning(WarningBlock(present=True, verbatim=None))
        assert result.verdict is Verdict.MISMATCH

    def test_altered_wording_is_a_mismatch_with_a_diff(self):
        altered = CANONICAL_WARNING.replace(
            "may cause health problems", "may cause serious health problems"
        )
        result = check_government_warning(compliant_warning(verbatim=altered))
        assert result.verdict is Verdict.MISMATCH
        assert result.diff
        assert any("serious" in operation.actual for operation in result.diff)

    def test_omitted_clause_is_a_mismatch(self):
        truncated = CANONICAL_WARNING.split(" (2)")[0]
        result = check_government_warning(compliant_warning(verbatim=truncated))
        assert result.verdict is Verdict.MISMATCH
        assert result.diff

    def test_title_case_prefix_fails_on_capitalization_not_wording(self):
        """The distinct failure mode named in the build plan."""
        title_case = CANONICAL_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:")
        result = check_government_warning(
            compliant_warning(verbatim=title_case, prefix_is_caps=False)
        )
        assert result.verdict is Verdict.MISMATCH
        assert "capital letters" in result.reason
        assert result.diff is None

    def test_capitalization_is_derived_from_text_when_no_signal_is_given(self):
        title_case = CANONICAL_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:")
        result = check_government_warning(
            compliant_warning(verbatim=title_case, prefix_is_caps=None)
        )
        assert result.verdict is Verdict.MISMATCH
        assert "capital letters" in result.reason


class TestSoftFailures:
    """Typography grades to needs review, per ADR-005."""

    def test_prefix_not_bold_is_needs_review(self):
        result = check_government_warning(compliant_warning(prefix_is_bold=False))
        assert result.verdict is Verdict.NEEDS_REVIEW
        assert "bold" in result.reason

    def test_bold_remainder_is_needs_review(self):
        """27 CFR 16.22(a): only the opening words may be bold."""
        result = check_government_warning(compliant_warning(remainder_is_bold=True))
        assert result.verdict is Verdict.NEEDS_REVIEW

    def test_undersized_type_is_needs_review_not_a_mismatch(self):
        result = check_government_warning(
            compliant_warning(estimated_type_size_mm=1.0), parse_volume("750 mL")
        )
        assert result.verdict is Verdict.NEEDS_REVIEW
        assert "2mm" in result.reason

    def test_unassessable_type_size_is_needs_review(self):
        result = check_government_warning(compliant_warning(estimated_type_size_mm=None))
        assert result.verdict is Verdict.NEEDS_REVIEW
        assert "could not be assessed" in result.reason


class TestConfidenceGating:
    """The warning gets the same confidence gate as every other field."""

    def test_low_confidence_downgrades_a_matching_warning(self):
        result = check_government_warning(compliant_warning(confidence=0.1))
        assert result.verdict is Verdict.NEEDS_REVIEW
        assert "low confidence" in result.reason

    def test_low_confidence_never_rescues_altered_wording(self):
        altered = CANONICAL_WARNING.replace("birth defects", "certain birth defects")
        result = check_government_warning(compliant_warning(verbatim=altered, confidence=0.1))
        assert result.verdict is Verdict.MISMATCH


class TestTypeSizeThresholds:
    """27 CFR 16.22(b), keyed to container volume."""

    @pytest.mark.parametrize(
        ("container", "expected_mm"),
        [
            ("50 mL", 1.0),
            ("237 mL", 1.0),
            ("750 mL", 2.0),
            ("3 L", 2.0),
            ("5 L", 3.0),
        ],
    )
    def test_threshold_by_container_size(self, container, expected_mm):
        assert minimum_type_size_mm(parse_volume(container)) == expected_mm

    def test_unknown_container_defaults_to_the_standard_bottle_band(self):
        assert minimum_type_size_mm(None) == 2.0

    def test_small_bottle_passes_at_one_millimetre(self):
        """1mm is undersized on a 750 mL bottle but compliant on a 50 mL one."""
        result = check_government_warning(
            compliant_warning(estimated_type_size_mm=1.0), parse_volume("50 mL")
        )
        assert result.verdict is Verdict.MATCH


class TestWordDiff:
    """The alignment the review view renders. Equal runs are part of the answer.

    The client marks the edits inside the statutory text, so the unchanged words
    either side of a change have to survive the trip.
    """

    def test_replacement_is_reported(self):
        operations = word_diff("may cause health problems", "may cause serious health problems")
        changed = [operation for operation in operations if operation.op != "equal"]
        assert changed
        assert changed[0].op in {"insert", "replace"}

    def test_unchanged_words_surround_the_change(self):
        operations = word_diff("may cause health problems", "may cause serious health problems")
        assert operations[0].op == "equal"
        assert operations[0].expected == "may cause"
        assert operations[-1].op == "equal"
        assert operations[-1].expected == "health problems"

    def test_identical_text_produces_no_changes(self):
        operations = word_diff(CANONICAL_WARNING, CANONICAL_WARNING)
        assert all(operation.op == "equal" for operation in operations)

    def test_capitalization_alone_is_not_a_wording_change(self):
        """An all-capitals label is a caps question, reported by its own check.

        Aligning case-sensitively would mark every word of such a label changed
        and bury the one word that actually was.
        """
        shouted = CANONICAL_WARNING.upper().replace("MAY CAUSE", "CAN CAUSE")
        changed = [
            operation for operation in word_diff(CANONICAL_WARNING, shouted) if operation.op != "equal"
        ]
        assert len(changed) == 1
        assert changed[0].expected == "may"
        assert changed[0].actual == "CAN"
