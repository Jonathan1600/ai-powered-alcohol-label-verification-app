"""Reads and validates the committed fixture manifest.

Validation is deliberately loud and happens once. A manifest referencing an
image that is not on disk is a broken deploy, and it should fail at startup with
a message naming the file rather than at whatever moment an agent happens to
click the card that is missing its picture.

The manifest is read-only: nothing in the request path ever writes to it. That
is what gives every evaluator an identical starting queue with no server-side
state to reset, which ADR-006 gets for free by having no database at all.
"""

from functools import lru_cache
from pathlib import Path

from app.seed.models import SeedManifest

# backend/app/seed/loader.py -> backend/fixtures
FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures"
MANIFEST_FILE = FIXTURE_DIR / "manifest.json"
IMAGE_DIR = FIXTURE_DIR / "images"
THUMBNAIL_DIR = FIXTURE_DIR / "thumbnails"


class SeedDataError(RuntimeError):
    """The committed fixture corpus is missing or inconsistent."""


def _validate(manifest: SeedManifest) -> SeedManifest:
    if manifest.count != len(manifest.items):
        raise SeedDataError(
            f"Manifest declares {manifest.count} fixtures but carries {len(manifest.items)}."
        )

    identifiers = [item.id for item in manifest.items]
    duplicates = sorted({name for name in identifiers if identifiers.count(name) > 1})
    if duplicates:
        raise SeedDataError(f"Duplicate fixture ids in the manifest: {', '.join(duplicates)}")

    references = [item.application_reference for item in manifest.items]
    repeated = sorted({ref for ref in references if references.count(ref) > 1})
    if repeated:
        raise SeedDataError(f"Duplicate application references: {', '.join(repeated)}")

    missing = [
        str(relative)
        for item in manifest.items
        for relative in (item.image, item.thumbnail)
        if not (FIXTURE_DIR / relative).is_file()
    ]
    if missing:
        raise SeedDataError(
            "Manifest references files that are not on disk: "
            f"{', '.join(missing[:5])}"
            f"{'' if len(missing) <= 5 else f' and {len(missing) - 5} more'}. "
            "Run `uv run python -m tools.generate_fixtures` with the fixtures group installed."
        )
    return manifest


@lru_cache(maxsize=1)
def load_manifest() -> SeedManifest:
    """Parse and validate the manifest once, then serve it from memory."""
    if not MANIFEST_FILE.is_file():
        raise SeedDataError(
            f"No fixture manifest at {MANIFEST_FILE}. It is committed to the "
            "repository, so this usually means an incomplete checkout."
        )
    return _validate(SeedManifest.model_validate_json(MANIFEST_FILE.read_text(encoding="utf-8")))
