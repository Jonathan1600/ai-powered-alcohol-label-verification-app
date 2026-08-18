"""Deterministic matching engine.

The public surface is deliberately small: `verify` takes what the applicant
claimed and what the model read, and returns verdicts. Everything else is an
implementation detail of that.
"""

from app.matching.contracts import (
    ApplicationRecord,
    BeverageClass,
    ExtractedField,
    ExtractedLabel,
    FieldName,
    FieldResult,
    OverallStatus,
    Readability,
    UnreadableReason,
    Verdict,
    VerificationResult,
    WarningBlock,
)
from app.matching.engine import verify
from app.matching.warning import CANONICAL_WARNING

__all__ = [
    "CANONICAL_WARNING",
    "ApplicationRecord",
    "BeverageClass",
    "ExtractedField",
    "ExtractedLabel",
    "FieldName",
    "FieldResult",
    "OverallStatus",
    "Readability",
    "UnreadableReason",
    "Verdict",
    "VerificationResult",
    "WarningBlock",
    "verify",
]
