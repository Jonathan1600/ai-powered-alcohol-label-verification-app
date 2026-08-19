"""The government warning, checked strictly. See ADR-005.

The statutory text is fixed, so this is the one field where any wording
difference is a real violation and gets compared character for character rather
than fuzzily. Typography is the exception: font weight and millimetre type sizes
cannot be judged reliably from a photograph, so those grade to needs review. A
false hard failure on a compliant label costs more trust than it saves.

Checks run in the order of the flow in architecture.md section 4, and the first
failure wins, so the agent gets the most fundamental problem rather than a pile
of consequences.
"""

import difflib

from app.matching.confidence import apply_confidence
from app.matching.contracts import DiffOp, FieldName, FieldResult, Verdict, WarningBlock
from app.matching.normalize import collapse_whitespace
from app.matching.quantities import Volume

# 27 CFR 16.21, verbatim. Any deviation from this is a mismatch.
CANONICAL_WARNING = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not "
    "drink alcoholic beverages during pregnancy because of the risk of birth "
    "defects. (2) Consumption of alcoholic beverages impairs your ability to "
    "drive a car or operate machinery, and may cause health problems."
)

REQUIRED_PREFIX = "GOVERNMENT WARNING:"

# 27 CFR 16.22(b): minimum type size in millimetres, keyed to container volume.
_TYPE_SIZE_SMALL_MAX_ML = 237.0  # 8 fl oz
_TYPE_SIZE_MEDIUM_MAX_ML = 3000.0  # 3 litres
_TYPE_SIZE_SMALL_MM = 1.0
_TYPE_SIZE_MEDIUM_MM = 2.0
_TYPE_SIZE_LARGE_MM = 3.0


def minimum_type_size_mm(container: Volume | None) -> float:
    """The smallest permitted type size for this container, per 27 CFR 16.22(b).

    Defaults to the 2mm band when the container size is unknown, since that
    covers standard bottles and is the case a label is most likely to be.
    """
    if container is None:
        return _TYPE_SIZE_MEDIUM_MM
    if container.milliliters <= _TYPE_SIZE_SMALL_MAX_ML:
        return _TYPE_SIZE_SMALL_MM
    if container.milliliters <= _TYPE_SIZE_MEDIUM_MAX_ML:
        return _TYPE_SIZE_MEDIUM_MM
    return _TYPE_SIZE_LARGE_MM


def word_diff(expected: str, actual: str) -> list[DiffOp]:
    """The full word-level alignment of the statutory text against the label's.

    Every opcode is emitted, `equal` runs included, because the review view
    renders the statutory text with the edits marked in place. Dropping the
    unchanged runs would hand the client the changed chunks with nowhere to put
    them back, and rebuilding that context by re-diffing in the browser would
    put a second implementation of this comparison in a second language.

    Words are aligned case-insensitively while the original text is what gets
    returned. Capitalization is a separate regulated question, checked and
    reported separately, so an all-capitals label whose wording was altered
    shows the altered words rather than every word it contains.

    Returned as data, not markup, so the review view owns how it renders.
    """
    expected_words = expected.split()
    actual_words = actual.split()
    matcher = difflib.SequenceMatcher(
        None,
        [word.casefold() for word in expected_words],
        [word.casefold() for word in actual_words],
    )

    return [
        DiffOp(
            op=tag,
            expected=" ".join(expected_words[i1:i2]),
            actual=" ".join(actual_words[j1:j2]),
        )
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
    ]


def _result(verdict: Verdict, reason: str, actual: str | None, diff=None) -> FieldResult:
    return FieldResult(
        field=FieldName.GOVERNMENT_WARNING,
        claimed=CANONICAL_WARNING,
        extracted=actual,
        verdict=verdict,
        reason=reason,
        diff=diff,
    )


def _prefix_is_capitalized(block: WarningBlock) -> bool | None:
    """Prefer the extractor's explicit signal, fall back to reading the text.

    The explicit signal exists because a transcription may silently regularize
    case; the text is the fallback when no signal was reported.
    """
    if block.prefix_is_caps is not None:
        return block.prefix_is_caps
    if block.verbatim:
        return collapse_whitespace(block.verbatim).startswith(REQUIRED_PREFIX)
    return None


def check_government_warning(
    block: WarningBlock,
    container: Volume | None = None,
) -> FieldResult:
    """Run the strict path and return the first failure, or a match."""
    if not block.present or not block.verbatim:
        return _result(
            Verdict.MISMATCH,
            "The health warning statement required by 27 CFR 16.21 does not appear on the label.",
            None,
        )

    actual = collapse_whitespace(block.verbatim)
    expected = collapse_whitespace(CANONICAL_WARNING)

    # Case-insensitive, because capitalization is a separate regulated question
    # checked next. A title-case warning should report as a capitalization
    # failure, not as twelve wording changes.
    if actual.casefold() != expected.casefold():
        return _result(
            Verdict.MISMATCH,
            "The warning wording does not match the statutory text in 27 CFR 16.21.",
            actual,
            diff=word_diff(expected, actual),
        )

    prefix_capitalized = _prefix_is_capitalized(block)
    if prefix_capitalized is False:
        return _result(
            Verdict.MISMATCH,
            'The words "GOVERNMENT WARNING:" must appear in capital letters (27 CFR 16.22(a)).',
            actual,
        )

    # Everything below is a typography judgement from a photograph, so it grades
    # to needs review rather than failing the label outright. See ADR-005.
    if block.prefix_is_bold is False:
        return _result(
            Verdict.NEEDS_REVIEW,
            'The words "GOVERNMENT WARNING:" must be bold (27 CFR 16.22(a)), '
            "and they do not appear bold. Confirm against the physical label.",
            actual,
        )

    if block.remainder_is_bold is True:
        return _result(
            Verdict.NEEDS_REVIEW,
            "Only the opening words may be bold; the rest of the warning must "
            "not be (27 CFR 16.22(a)). Confirm against the physical label.",
            actual,
        )

    minimum_mm = minimum_type_size_mm(container)
    if block.estimated_type_size_mm is None:
        return _result(
            Verdict.NEEDS_REVIEW,
            f"Type size could not be assessed from this image. It must be at "
            f"least {minimum_mm:g}mm for this container size (27 CFR 16.22(b)).",
            actual,
        )

    if block.estimated_type_size_mm < minimum_mm:
        return _result(
            Verdict.NEEDS_REVIEW,
            f"The warning appears to be about "
            f"{block.estimated_type_size_mm:g}mm, below the {minimum_mm:g}mm "
            f"minimum for this container size (27 CFR 16.22(b)). Measure to "
            f"confirm.",
            actual,
        )

    # A warning transcribed with low confidence gets the same treatment as any
    # other field, rather than clearing on the strength of a doubtful reading.
    return apply_confidence(
        _result(
            Verdict.MATCH,
            "The warning matches the statutory text and meets the capitalization, "
            "weight, and type size requirements.",
            actual,
        ),
        block.confidence,
    )
