"""Projects the fixture specs into the committed `fixtures/manifest.json`.

Deliberately free of any image library. Building the manifest is pure data work,
so `tests/test_seed_manifest.py` can rebuild it in memory and compare it against
the committed file, catching drift when somebody edits a spec and forgets to
regenerate. That check runs in CI, where Pillow is not installed.
"""

import json
from typing import Any

from app.matching.contracts import (
    ExtractedField,
    ExtractedLabel,
    FieldName,
    Readability,
    WarningBlock,
)
from tools.fixtures.specs import SPECS, LabelSpec

MANIFEST_VERSION = 1

IMAGE_DIR = "images"
THUMBNAIL_DIR = "thumbnails"


def image_path(spec: LabelSpec) -> str:
    return f"{IMAGE_DIR}/{spec.id}.png"


def thumbnail_path(spec: LabelSpec) -> str:
    return f"{THUMBNAIL_DIR}/{spec.id}.jpg"


def ground_truth_extraction(spec: LabelSpec) -> ExtractedLabel:
    """The reading a perfect extractor would return for this label.

    Confidence is 1.0 across the board because this is not an estimate: the
    renderer drew exactly these strings at exactly this type size. The interest
    in phase 8 is precisely the distance between this and what the model reports.
    """
    if spec.is_unreadable:
        return ExtractedLabel(
            readability=Readability(
                unreadable=True,
                reason=spec.expected.unreadable_reason,
                notes=spec.probes,
            )
        )

    warning = spec.warning
    return ExtractedLabel(
        readability=Readability(unreadable=False),
        brand_name=ExtractedField(verbatim=spec.label_text(FieldName.BRAND_NAME)),
        class_type=ExtractedField(verbatim=spec.label_text(FieldName.CLASS_TYPE)),
        alcohol_content=ExtractedField(verbatim=spec.label_text(FieldName.ALCOHOL_CONTENT)),
        net_contents=ExtractedField(verbatim=spec.label_text(FieldName.NET_CONTENTS)),
        bottler_info=ExtractedField(verbatim=spec.label_text(FieldName.BOTTLER_INFO)),
        country_of_origin=ExtractedField(
            verbatim=spec.label_text(FieldName.COUNTRY_OF_ORIGIN)
        ),
        government_warning=WarningBlock(
            present=warning.present,
            verbatim=warning.text or None,
            prefix_is_caps=warning.prefix_is_caps if warning.present else None,
            prefix_is_bold=warning.prefix_is_bold if warning.present else None,
            remainder_is_bold=warning.remainder_is_bold if warning.present else None,
            estimated_type_size_mm=warning.type_size_mm,
        ),
    )


def build_item(spec: LabelSpec) -> dict[str, Any]:
    """One manifest entry, carrying all three of the uses this corpus serves."""
    return {
        "id": spec.id,
        "application_reference": spec.application_reference,
        "brand_name": spec.application.brand_name,
        "probes": spec.probes,
        "degradation": spec.degradation.value,
        "image": image_path(spec),
        "thumbnail": thumbnail_path(spec),
        "application": spec.application.model_dump(mode="json"),
        "ground_truth": ground_truth_extraction(spec).model_dump(mode="json"),
        "expected": {
            "status": spec.expected.status.value,
            "unreadable_reason": (
                spec.expected.unreadable_reason.value
                if spec.expected.unreadable_reason
                else None
            ),
            "fields": [
                {
                    "field": expectation.field.value,
                    "verdict": expectation.verdict.value,
                    "note": expectation.note,
                }
                for expectation in spec.expected.fields
            ],
        },
    }


def build_manifest(specs: tuple[LabelSpec, ...] = SPECS) -> dict[str, Any]:
    return {
        "version": MANIFEST_VERSION,
        "generator": "tools/generate_fixtures.py",
        "count": len(specs),
        "items": [build_item(spec) for spec in specs],
    }


def render_manifest_json(specs: tuple[LabelSpec, ...] = SPECS) -> str:
    """Serialize exactly as the generator writes it, so the drift test compares equals.

    `ensure_ascii` stays on so the committed file is plain ASCII and the curly
    apostrophe in the STONE'S THROW fixture survives any checkout encoding.
    """
    return json.dumps(build_manifest(specs), indent=2, ensure_ascii=True) + "\n"
