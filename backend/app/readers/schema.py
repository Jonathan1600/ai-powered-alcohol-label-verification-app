"""The wire shape the model is actually asked for, and its mapping to the contract.

Almost every field here is `ExtractedLabel` unchanged, and the phase 4 spike
confirmed the contract binds to strict structured outputs as it stands. This
module exists for one field.

`WarningBlock.estimated_type_size_mm` asks for millimetres. A model looking at a
photograph sees pixels and has no reference object, so asking it for a physical
measurement asks it to guess at a conversion rather than to report an
observation, which is exactly the split ADR-001 draws. The spike bore that out:
`gpt-4.1-mini` returned null for the millimetre field on a label whose type size
is known to be 2.2mm.

So the model is asked for `cap_height_ratio` instead, a dimensionless quantity
it can genuinely observe, and this module does the conversion to millimetres.

The same measurement retired a second field. `prefix_is_caps` is no longer asked
for at all, because the model reported it as True on a label whose warning it had
just correctly transcribed in title case. Capitalisation is recoverable from the
transcription with certainty, so it is derived rather than believed.

The engine, `WarningBlock`, and the committed manifest are all untouched.
"""

from pydantic import BaseModel, Field

from app.matching.contracts import (
    ExtractedField,
    ExtractedLabel,
    Readability,
    UnreadableReason,
    WarningBlock,
)

# A label is not in the frame with a ruler, so the ratio has to be anchored to an
# assumed physical height. 120mm is the fixture corpus's rendered label height
# and sits in the normal range for a 750ml bottle's front label. It is the
# loosest link in the type size check and is recorded in assumptions.md section 4
# as a phase 8 calibration target rather than presented as a measurement.
ASSUMED_LABEL_HEIGHT_MM = 120.0


class ObservedField(BaseModel):
    """One field as read off the label."""

    verbatim: str | None = Field(
        description=(
            "The text exactly as printed, preserving capitalisation, punctuation, "
            "and apostrophe style. Null when the field does not appear on the label."
        )
    )
    confidence: float = Field(
        description=(
            "How certain you are that this reading is correct, from 0 to 1. When "
            "verbatim is null this is your confidence that the field is genuinely "
            "absent, not zero."
        )
    )


class ObservedWarning(BaseModel):
    """The health warning block and the typography signals 27 CFR 16.22 turns on."""

    present: bool = Field(description="Whether any government warning block appears at all.")
    verbatim: str | None = Field(
        description=(
            "The complete warning text exactly as printed, transcribed character for "
            "character. Never correct, complete, or standardise it."
        )
    )
    prefix_is_bold: bool | None = Field(
        description="Whether those opening words are bold. Null if you cannot tell."
    )
    remainder_is_bold: bool | None = Field(
        description=(
            "Whether the text after the opening words is bold. Null if you cannot tell."
        )
    )
    cap_height_ratio: float | None = Field(
        description=(
            "The capital letter height of the warning text divided by the full height "
            "of the image, as a decimal. A warning whose capitals are about a fiftieth "
            "of the image height gives 0.02. Null if you cannot judge it."
        )
    )
    confidence: float = Field(description="Certainty in the transcription above, from 0 to 1.")


class ObservedReadability(BaseModel):
    """Whether a human reviewer can directly read the material label text."""

    unreadable: bool = Field(
        description=(
            "True when glare, blur, angle, or resolution makes any material "
            "verification text hard for a human to read directly. Do not infer or "
            "reconstruct obscured text from expected label or statutory wording. A "
            "plainly visible label is readable even when unusual or non-compliant."
        )
    )
    reason: UnreadableReason | None = Field(
        description=(
            "The one primary physical defect that prevents reading. Use glare for bright "
            "reflection, overexposure, or washed-out contrast; angle for oblique perspective "
            "distortion; and blur only for out-of-focus or motion softness when neither glare "
            "nor angle is the primary cause. Null when readable."
        )
    )
    notes: str | None = Field(
        description="One short phrase naming what obscures the label. Null when readable."
    )


class LabelObservation(BaseModel):
    """The complete structured reading, as the model is asked to return it."""

    readability: ObservedReadability
    brand_name: ObservedField
    class_type: ObservedField
    alcohol_content: ObservedField
    net_contents: ObservedField
    bottler_info: ObservedField
    country_of_origin: ObservedField
    government_warning: ObservedWarning


def _clamp(value: float) -> float:
    """Confidence is bounded in the contract but only described in the schema.

    Numeric bounds are left out of the wire schema deliberately: they add tokens
    to no purpose, and a model returning 1.2 should be corrected here rather than
    raising a validation error that costs the whole call.
    """
    return max(0.0, min(1.0, value))


def _field(observed: ObservedField) -> ExtractedField:
    return ExtractedField(verbatim=observed.verbatim, confidence=_clamp(observed.confidence))


def to_contract(observation: LabelObservation) -> ExtractedLabel:
    """Map a reading onto the contract the matching engine consumes."""
    warning = observation.government_warning
    type_size_mm = (
        warning.cap_height_ratio * ASSUMED_LABEL_HEIGHT_MM
        if warning.cap_height_ratio is not None
        else None
    )

    return ExtractedLabel(
        readability=Readability(
            unreadable=observation.readability.unreadable,
            # A reason without an unreadable verdict is noise, and the engine only
            # reads the reason on the unreadable path.
            reason=observation.readability.reason if observation.readability.unreadable else None,
            notes=observation.readability.notes if observation.readability.unreadable else None,
        ),
        brand_name=_field(observation.brand_name),
        class_type=_field(observation.class_type),
        alcohol_content=_field(observation.alcohol_content),
        net_contents=_field(observation.net_contents),
        bottler_info=_field(observation.bottler_info),
        country_of_origin=_field(observation.country_of_origin),
        government_warning=WarningBlock(
            present=warning.present,
            verbatim=warning.verbatim,
            # Deliberately never asked for. Phase 4 measurement found the model
            # transcribes a title-case warning faithfully and then reports the
            # capitalisation signal as True anyway, which turned a real violation
            # into a clean pass. The transcription is the trustworthy artefact, so
            # None is passed and `app.matching.warning` derives capitalisation
            # from the verbatim text through the fallback it already carries.
            prefix_is_caps=None,
            prefix_is_bold=warning.prefix_is_bold,
            remainder_is_bold=warning.remainder_is_bold,
            estimated_type_size_mm=type_size_mm,
            confidence=_clamp(warning.confidence),
        ),
    )


__all__ = [
    "ASSUMED_LABEL_HEIGHT_MM",
    "LabelObservation",
    "ObservedField",
    "ObservedReadability",
    "ObservedWarning",
    "to_contract",
]
