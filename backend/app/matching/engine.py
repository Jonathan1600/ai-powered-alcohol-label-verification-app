"""Field dispatch and item-level status.

This is the whole deterministic half in one entry point: give it what the
applicant claimed and what the model read, and it returns the per-field verdicts
plus the status the queue sorts on. No network, no clock, no I/O.
"""

from app.matching.comparators import (
    compare_alcohol_content_field,
    compare_bottler_info,
    compare_brand_name,
    compare_class_type,
    compare_country_of_origin,
    compare_net_contents,
)
from app.matching.contracts import (
    ApplicationRecord,
    ExtractedLabel,
    FieldResult,
    OverallStatus,
    Verdict,
    VerificationResult,
)
from app.matching.quantities import parse_volume
from app.matching.warning import check_government_warning


def derive_status(fields: list[FieldResult]) -> OverallStatus:
    """Worst verdict wins, so one real problem is never averaged away."""
    verdicts = {field.verdict for field in fields}
    if Verdict.MISMATCH in verdicts:
        return OverallStatus.PROBLEM_FOUND
    if Verdict.NEEDS_REVIEW in verdicts:
        return OverallStatus.NEEDS_REVIEW
    return OverallStatus.LOOKS_CORRECT


def verify(application: ApplicationRecord, extraction: ExtractedLabel) -> VerificationResult:
    """Compare one application against one label reading.

    An unreadable image short-circuits before any comparison runs. Returning
    field verdicts computed from a photograph nobody could read would dress a
    guess up as evidence, and approach.md section 5.4 makes that a distinct
    outcome rather than a low-confidence answer.
    """
    if extraction.readability.unreadable:
        return VerificationResult(
            status=OverallStatus.UNREADABLE,
            fields=[],
            unreadable_reason=extraction.readability.reason,
        )

    fields = [
        compare_brand_name(application, extraction.brand_name),
        compare_class_type(application, extraction.class_type),
        compare_alcohol_content_field(application, extraction.alcohol_content),
        compare_net_contents(application, extraction.net_contents),
        compare_bottler_info(application, extraction.bottler_info),
    ]

    # Country of origin is required only for imports. On a domestic product the
    # field is left out of the results entirely rather than given a fourth
    # verdict state, which keeps the three-state promise in ADR-003 intact.
    if application.is_import:
        fields.append(compare_country_of_origin(application, extraction.country_of_origin))

    # The minimum type size depends on container volume, so the warning check
    # needs the net contents the label itself declares.
    container = parse_volume(extraction.net_contents.verbatim) or parse_volume(
        application.net_contents
    )
    fields.append(check_government_warning(extraction.government_warning, container))

    return VerificationResult(status=derive_status(fields), fields=fields)
