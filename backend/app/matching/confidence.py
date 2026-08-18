"""The confidence gate, shared by every field.

It lives in its own module so the ordinary comparators and the government
warning path can apply one rule without either importing the other. A warning
read badly is the last field that should slip through unremarked.
"""

from app.matching.contracts import FieldResult, Verdict

# Below this, an extraction is not trusted enough to clear a field on its own.
# It only ever downgrades a match; it never rescues a mismatch, because a field
# read poorly and a field read wrongly both deserve a human look.
LOW_CONFIDENCE_THRESHOLD = 0.75


def apply_confidence(result: FieldResult, confidence: float) -> FieldResult:
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
