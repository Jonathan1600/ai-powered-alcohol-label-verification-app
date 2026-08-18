"""Models forming the boundary between the probabilistic and deterministic halves.

Everything the vision model produces enters through `ExtractedLabel`; everything
the agent sees leaves through `VerificationResult`. Nothing in this module knows
how extraction happens, which is what lets the whole engine be tested offline.
"""

from enum import Enum

from pydantic import BaseModel, Field


class Verdict(str, Enum):
    """Per-field outcome. Three states only, per ADR-003."""

    MATCH = "match"
    NEEDS_REVIEW = "needs_review"
    MISMATCH = "mismatch"


class OverallStatus(str, Enum):
    """Item-level outcome derived from the field verdicts.

    `UNREADABLE` is not a verdict rollup; it short-circuits matching entirely
    so a bad photograph never masquerades as a compliance finding.
    """

    LOOKS_CORRECT = "looks_correct"
    NEEDS_REVIEW = "needs_review"
    PROBLEM_FOUND = "problem_found"
    UNREADABLE = "unreadable"


class BeverageClass(str, Enum):
    """Selects the alcohol-content tolerance band. See `matching.quantities`."""

    WINE = "wine"
    DISTILLED_SPIRITS = "distilled_spirits"
    MALT_BEVERAGE = "malt_beverage"


class UnreadableReason(str, Enum):
    GLARE = "glare"
    ANGLE = "angle"
    BLUR = "blur"
    RESOLUTION = "resolution"


class FieldName(str, Enum):
    BRAND_NAME = "brand_name"
    CLASS_TYPE = "class_type"
    ALCOHOL_CONTENT = "alcohol_content"
    NET_CONTENTS = "net_contents"
    BOTTLER_INFO = "bottler_info"
    COUNTRY_OF_ORIGIN = "country_of_origin"
    GOVERNMENT_WARNING = "government_warning"


class ExtractedField(BaseModel):
    """One field as it literally appears on the label.

    `verbatim` is None when the model could not find the field at all, which is
    a different thing from finding it empty and must stay distinguishable.
    """

    verbatim: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class WarningBlock(BaseModel):
    """The health warning plus the typography signals 27 CFR 16.22 cares about.

    The regulation requires the opening words in capitals *and* bold, and the
    remainder *not* bold, so weight is tracked separately for each rather than
    as one flag for the block.

    Every typography signal is optional because a photograph may not support the
    judgement. None means "could not assess", which grades to needs review; it
    never silently reads as compliant.
    """

    present: bool = False
    verbatim: str | None = None
    prefix_is_caps: bool | None = None
    prefix_is_bold: bool | None = None
    remainder_is_bold: bool | None = None
    estimated_type_size_mm: float | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class Readability(BaseModel):
    """Whether the image can be read at all, decided before any matching runs."""

    unreadable: bool = False
    reason: UnreadableReason | None = None
    notes: str | None = None


class ExtractedLabel(BaseModel):
    """The complete structured reading of one label image."""

    readability: Readability = Field(default_factory=Readability)
    brand_name: ExtractedField = Field(default_factory=ExtractedField)
    class_type: ExtractedField = Field(default_factory=ExtractedField)
    alcohol_content: ExtractedField = Field(default_factory=ExtractedField)
    net_contents: ExtractedField = Field(default_factory=ExtractedField)
    bottler_info: ExtractedField = Field(default_factory=ExtractedField)
    country_of_origin: ExtractedField = Field(default_factory=ExtractedField)
    government_warning: WarningBlock = Field(default_factory=WarningBlock)


class ApplicationRecord(BaseModel):
    """What the applicant claims, standing in for the COLA submission.

    `beverage_class` picks the tolerance band and `is_import` decides whether
    country of origin is evaluated at all.
    """

    brand_name: str
    class_type: str
    alcohol_content: str
    net_contents: str
    bottler_info: str
    country_of_origin: str | None = None
    beverage_class: BeverageClass = BeverageClass.DISTILLED_SPIRITS
    is_import: bool = False


class DiffOp(BaseModel):
    """One word-level edit turning the statutory text into what the label says.

    Emitted as data rather than rendered markup so the review view owns
    presentation.
    """

    op: str
    expected: str = ""
    actual: str = ""


class FieldResult(BaseModel):
    field: FieldName
    claimed: str | None
    extracted: str | None
    verdict: Verdict
    reason: str
    diff: list[DiffOp] | None = None


class VerificationResult(BaseModel):
    status: OverallStatus
    fields: list[FieldResult] = Field(default_factory=list)
    unreadable_reason: UnreadableReason | None = None
