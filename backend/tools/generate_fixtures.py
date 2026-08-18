"""Regenerates the committed fixture corpus.

    uv sync --group fixtures
    uv run python -m tools.generate_fixtures

Writes `fixtures/manifest.json`, a PNG per fixture, and a thumbnail per fixture.
Everything it produces is committed, because Render builds with `--no-dev` and
must never need an image library or a generation step at deploy time.

The run is idempotent: same specs in, byte-identical files out. `--manifest-only`
skips the images and needs no Pillow, which is what the drift check in
`tests/test_seed_manifest.py` relies on.
"""

import argparse
import sys
from pathlib import Path

from tools.fixtures.manifest import image_path, render_manifest_json, thumbnail_path
from tools.fixtures.specs import SPECS

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"
MANIFEST_FILE = FIXTURE_DIR / "manifest.json"


def write_manifest() -> None:
    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(render_manifest_json(), encoding="utf-8")
    print(f"manifest: {len(SPECS)} fixtures -> {MANIFEST_FILE.relative_to(FIXTURE_DIR.parent)}")


def write_images() -> None:
    # Imported here so that --manifest-only runs with no image library present.
    from tools.fixtures.render import render, thumbnail

    expected: set[Path] = set()
    for spec in SPECS:
        image = render(spec)
        image_file = FIXTURE_DIR / image_path(spec)
        thumbnail_file = FIXTURE_DIR / thumbnail_path(spec)
        image_file.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_file.parent.mkdir(parents=True, exist_ok=True)

        image.save(image_file, format="PNG", optimize=True)
        thumbnail(image).save(
            thumbnail_file, format="JPEG", quality=80, optimize=True, progressive=False
        )
        expected |= {image_file, thumbnail_file}
        print(f"  {spec.id:<26} {spec.degradation.value}")

    # A fixture removed from specs.py should not leave its image behind to be
    # served by a loader that no longer knows about it.
    for directory in ("images", "thumbnails"):
        for stale in sorted((FIXTURE_DIR / directory).glob("*")):
            if stale.is_file() and stale not in expected:
                stale.unlink()
                print(f"  removed stale {stale.name}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="Rewrite manifest.json without rendering images. Needs no Pillow.",
    )
    arguments = parser.parse_args(argv)

    write_manifest()
    if not arguments.manifest_only:
        write_images()
    return 0


if __name__ == "__main__":
    sys.exit(main())
