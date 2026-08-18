"""Per-field comparison strategies.

Every comparator returns a `FieldResult` carrying a plain-English reason. Under
the review model in approach.md section 3 the agent decides, not the tool, so the
reason string is the actual product: it has to say what differed and why that
does or does not matter.

The general shape is normalized exact match, then a fuzzy tier that grades to
needs review, then mismatch. Numeric fields skip string comparison entirely.
"""

from collections.abc import Callable
from difflib import SequenceMatcher

from app.matching.contracts import (
    ApplicationRecord,
    ExtractedField,
    FieldName,
    FieldResult,
    Verdict,
)
from app.matching.normalize import (
    normalize,
    normalize_address,
    normalize_class_type,
    strip_punctuation,
    token_sort,
)
from app.matching.quantities import (
    Comparison,
    abv_tolerance,
    compare_alcohol_content,
    compare_volume,
    parse_alcohol_content,
    parse_volume,
)

# Below this, an extraction is not trusted enough to clear a field on its own.
# It only ever downgrades a match; it never rescues a mismatch, because a field
# read poorly and a field read wrongly both deserve a human look.
LOW_CONFIDENCE_THRESHOLD = 0.75

# Close enough to be a transcription difference rather than a different product.
_BRAND_REVIEW_THRESHOLD = 0.85
_CLASS_TYPE_REVIEW_THRESHOLD = 0.85

# Addresses vary harmlessly in form far more than brand names do, so this tier
# is deliberately wide. Biasing toward needs review is the instruction in
# approach.md section 5.3.
_ADDRESS_REVIEW_THRESHOLD = 0.70


def _similarity(first: str, second: str) -> float:
    return SequenceMatcher(None, first, second).ratio()


def _apply_confidence(result: FieldResult, confidence: float) -> FieldResult:
    """Downgrade a clean match when the extraction itself was uncertain."""
    if result.verdict is not Verdict.MATCH or confidence >= LOW_CONFIDENCE_THRESHOLD:
        return result
    return result.model_copy(
        update={
            "verdict": Verdict.NEEDS_REVIEW,
            "reason": (
                f"{result.reason} The value was read from the image with low "
                f"confidence, so it is worth confirming by eye."
            ),
        }
    )


def _missing(field: FieldName, claimed: str | None, described: str) -> FieldResult:
    return FieldResult(
        field=field,
        claimed=claimed,
        extracted=None,
        verdict=Verdict.MISMATCH,
        reason=f"The application states {described}, but it does not appear on the label.",
    )


def _unstated(field: FieldName, extracted: str | None, described: str) -> FieldResult:
    return FieldResult(
        field=field,
        claimed=None,
        extracted=extracted,
        verdict=Verdict.NEEDS_REVIEW,
        reason=(
            f"The label shows {described}, but the application does not state a "
            f"value to check it against."
        ),
    )


def compare_text(
    field: FieldName,
    claimed: str | None,
    extracted: ExtractedField,
    *,
    label: str,
    normalizer: Callable[[str | None], str] = normalize,
    review_threshold: float = _BRAND_REVIEW_THRESHOLD,
    order_insensitive: bool = False,
) -> FieldResult:
    """Normalized exact match, then a fuzzy tier, then mismatch."""
    actual = extracted.verbatim

    if not claimed and not actual:
        return FieldResult(
            field=field,
            claimed=None,
            extracted=None,
            verdict=Verdict.MATCH,
            reason=f"Neither the application nor the label states a {label}.",
        )
    if not actual:
        return _missing(field, claimed, f'a {label} of "{claimed}"')
    if not claimed:
        return _unstated(field, actual, f'a {label} of "{actual}"')

    claimed_normalized = normalizer(claimed)
    actual_normalized = normalizer(actual)

    if claimed_normalized == actual_normalized:
        return _apply_confidence(
            FieldResult(
                field=field,
                claimed=claimed,
                extracted=actual,
                verdict=Verdict.MATCH,
                reason=f"The {label} on the label matches the application.",
            ),
            extracted.confidence,
        )

    if order_insensitive and token_sort(claimed_normalized) == token_sort(actual_normalized):
        return _apply_confidence(
            FieldResult(
                field=field,
                claimed=claimed,
                extracted=actual,
                verdict=Verdict.MATCH,
                reason=(
                    f"The {label} matches the application, with the same words "
                    f"in a different order."
                ),
            ),
            extracted.confidence,
        )

    # Ignore punctuation before scoring, so that a stray comma does not drag an
    # otherwise identical value below the threshold.
    ratio = _similarity(strip_punctuation(claimed_normalized), strip_punctuation(actual_normalized))
    if ratio >= review_threshold:
        return FieldResult(
            field=field,
            claimed=claimed,
            extracted=actual,
            verdict=Verdict.NEEDS_REVIEW,
            reason=(
                f'The {label} is close but not identical: the application says '
                f'"{claimed}" and the label reads "{actual}".'
            ),
        )

    return FieldResult(
        field=field,
        claimed=claimed,
        extracted=actual,
        verdict=Verdict.MISMATCH,
        reason=(
            f'The {label} does not match: the application says "{claimed}" but '
            f'the label reads "{actual}".'
        ),
    )


def compare_brand_name(application: ApplicationRecord, extracted: ExtractedField) -> FieldResult:
    return compare_text(
        FieldName.BRAND_NAME,
        application.brand_name,
        extracted,
        label="brand name",
    )


def compare_class_type(application: ApplicationRecord, extracted: ExtractedField) -> FieldResult:
    return compare_text(
        FieldName.CLASS_TYPE,
        application.class_type,
        extracted,
        label="class or type designation",
        normalizer=normalize_class_type,
        review_threshold=_CLASS_TYPE_REVIEW_THRESHOLD,
        order_insensitive=True,
    )


def compare_bottler_info(application: ApplicationRecord, extracted: ExtractedField) -> FieldResult:
    return compare_text(
        FieldName.BOTTLER_INFO,
        application.bottler_info,
        extracted,
        label="bottler name and address",
        normalizer=normalize_address,
        review_threshold=_ADDRESS_REVIEW_THRESHOLD,
    )


def compare_country_of_origin(
    application: ApplicationRecord, extracted: ExtractedField
) -> FieldResult:
    """Only called for imports. Domestic products omit the field entirely."""
    if not extracted.verbatim:
        return FieldResult(
            field=FieldName.COUNTRY_OF_ORIGIN,
            claimed=application.country_of_origin,
            extracted=None,
            verdict=Verdict.MISMATCH,
            reason=(
                "This is an imported product, so the label must state a country "
                "of origin, and none appears."
            ),
        )
    return compare_text(
        FieldName.COUNTRY_OF_ORIGIN,
        application.country_of_origin,
        extracted,
        label="country of origin",
    )


def compare_alcohol_content_field(
    application: ApplicationRecord, extracted: ExtractedField
) -> FieldResult:
    """Parse both sides to numbers, then apply the tolerance band for the class."""
    claimed_text = application.alcohol_content
    actual_text = extracted.verbatim

    if not actual_text:
        return _missing(FieldName.ALCOHOL_CONTENT, claimed_text, "an alcohol content")

    claimed = parse_alcohol_content(claimed_text)
    actual = parse_alcohol_content(actual_text)

    def build(verdict: Verdict, reason: str) -> FieldResult:
        return FieldResult(
            field=FieldName.ALCOHOL_CONTENT,
            claimed=claimed_text,
            extracted=actual_text,
            verdict=verdict,
            reason=reason,
        )

    if claimed is None or actual is None:
        unparsed = claimed_text if claimed is None else actual_text
        return build(
            Verdict.NEEDS_REVIEW,
            f'No alcohol percentage could be read from "{unparsed}", so the two '
            f"values could not be compared numerically.",
        )

    # Proof is twice alcohol by volume, by definition. A label stating both and
    # disagreeing with itself is a defect regardless of what the application says.
    if not actual.proof_is_consistent:
        return build(
            Verdict.MISMATCH,
            f"The label contradicts itself: {actual.abv:g}% alcohol by volume is "
            f"{actual.abv * 2:g} proof, but the label states {actual.proof:g} proof.",
        )

    outcome, difference = compare_alcohol_content(claimed, actual, application.beverage_class)

    if outcome is Comparison.EQUAL:
        return _apply_confidence(
            build(
                Verdict.MATCH,
                f"The alcohol content matches the application at {actual.abv:g}% "
                f"alcohol by volume.",
            ),
            extracted.confidence,
        )

    if outcome is Comparison.CROSSES_TAX_CLASS:
        return build(
            Verdict.MISMATCH,
            f"The application says {claimed.abv:g}% and the label reads "
            f"{actual.abv:g}%. These fall either side of the 14% threshold, which "
            f"separates two tax classes, so no tolerance applies "
            f"(27 CFR 4.36(b)(2)).",
        )

    tolerance = abv_tolerance(application.beverage_class, min(claimed.abv, actual.abv))

    if outcome is Comparison.WITHIN_TOLERANCE:
        return build(
            Verdict.NEEDS_REVIEW,
            f"The application says {claimed.abv:g}% and the label reads "
            f"{actual.abv:g}%, a difference of {difference:g} points. That is "
            f"within the {tolerance:g} point tolerance for this product, but the "
            f"two documents should still agree.",
        )

    return build(
        Verdict.MISMATCH,
        f"The application says {claimed.abv:g}% but the label reads "
        f"{actual.abv:g}%, a difference of {difference:g} points. The tolerance "
        f"for this product is {tolerance:g} points.",
    )


def compare_net_contents(application: ApplicationRecord, extracted: ExtractedField) -> FieldResult:
    """Compare declared volumes after converting both to a common unit."""
    claimed_text = application.net_contents
    actual_text = extracted.verbatim

    if not actual_text:
        return _missing(FieldName.NET_CONTENTS, claimed_text, "a net contents")

    claimed = parse_volume(claimed_text)
    actual = parse_volume(actual_text)

    def build(verdict: Verdict, reason: str) -> FieldResult:
        return FieldResult(
            field=FieldName.NET_CONTENTS,
            claimed=claimed_text,
            extracted=actual_text,
            verdict=verdict,
            reason=reason,
        )

    if claimed is None or actual is None:
        unparsed = claimed_text if claimed is None else actual_text
        return build(
            Verdict.NEEDS_REVIEW,
            f'No quantity and unit could be read from "{unparsed}", so the two '
            f"values could not be compared.",
        )

    if compare_volume(claimed, actual) is Comparison.EQUAL:
        return _apply_confidence(
            build(
                Verdict.MATCH,
                f"The net contents match the application at {actual_text}.",
            ),
            extracted.confidence,
        )

    return build(
        Verdict.MISMATCH,
        f'The net contents do not match: the application says "{claimed_text}" '
        f'({claimed.milliliters:g} mL) but the label reads "{actual_text}" '
        f"({actual.milliliters:g} mL).",
    )
