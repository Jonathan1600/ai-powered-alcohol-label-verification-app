"""The manifest is committed, so these guard it against silent drift.

The drift check rebuilds the manifest from `tools/fixtures/specs.py` in memory
and compares it against the committed file. It runs with no image library
present, which is why `manifest.py` and `render.py` are separate modules: CI
installs only the dev group and would otherwise have to skip this entirely.

The coverage assertions turn "covers each failure mode" from a claim in the
build plan into something a red build reports.
"""

from app.matching.contracts import (
    BeverageClass,
    FieldName,
    OverallStatus,
    UnreadableReason,
    Verdict,
)
from app.seed.loader import FIXTURE_DIR, MANIFEST_FILE, load_manifest
from tools.fixtures.manifest import render_manifest_json

MANIFEST = load_manifest()


def test_the_committed_manifest_matches_the_specs() -> None:
    """Edit a spec without regenerating and this is what says so."""
    assert MANIFEST_FILE.read_text(encoding="utf-8") == render_manifest_json(), (
        "fixtures/manifest.json is out of date with tools/fixtures/specs.py. "
        "Regenerate with: uv run python -m tools.generate_fixtures"
    )


def test_every_referenced_file_exists() -> None:
    for fixture in MANIFEST.items:
        assert (FIXTURE_DIR / fixture.image).is_file(), f"{fixture.id}: image missing"
        assert (FIXTURE_DIR / fixture.thumbnail).is_file(), f"{fixture.id}: thumbnail missing"


def test_thumbnails_are_smaller_than_their_labels() -> None:
    """The queue ships thumbnails so it does not download forty full images."""
    for fixture in MANIFEST.items:
        image = (FIXTURE_DIR / fixture.image).stat().st_size
        thumbnail = (FIXTURE_DIR / fixture.thumbnail).stat().st_size
        assert thumbnail < image, f"{fixture.id}: thumbnail is not smaller than the label"


def test_identifiers_are_unique() -> None:
    assert len({f.id for f in MANIFEST.items}) == len(MANIFEST.items)
    assert len({f.application_reference for f in MANIFEST.items}) == len(MANIFEST.items)


def test_every_record_sets_its_beverage_class_explicitly() -> None:
    """Closes the gap in assumptions.md section 8.

    `beverage_class` defaults to distilled spirits, so a wine record that omits
    it silently takes the 0.3 point band instead of 1.5. Nothing in the data
    would look wrong. The corpus is where that has to be caught.
    """
    for fixture in MANIFEST.items:
        assert isinstance(fixture.application.beverage_class, BeverageClass)
        if "wine" in fixture.id or "sake" in fixture.id:
            assert fixture.application.beverage_class is BeverageClass.WINE, fixture.id
        if "malt" in fixture.id:
            assert fixture.application.beverage_class is BeverageClass.MALT_BEVERAGE, fixture.id


def test_imports_declare_a_country_of_origin_on_the_application() -> None:
    for fixture in MANIFEST.items:
        if fixture.application.is_import:
            assert fixture.application.country_of_origin, f"{fixture.id}: import with no country"
        else:
            assert fixture.application.country_of_origin is None, (
                f"{fixture.id}: domestic product carrying a country of origin"
            )


def test_the_queue_is_mostly_clean() -> None:
    """A queue where half the items are violations misrepresents the job.

    approach.md section 5.8 asks for realistic proportions, so the passing
    fixtures have to stay in the majority as the corpus grows.
    """
    clean = sum(1 for f in MANIFEST.items if f.expected.status is OverallStatus.LOOKS_CORRECT)
    assert clean > len(MANIFEST.items) / 2, f"only {clean} of {len(MANIFEST.items)} pass cleanly"


def test_every_overall_status_is_represented() -> None:
    present = {fixture.expected.status for fixture in MANIFEST.items}
    assert present == set(OverallStatus), f"missing: {set(OverallStatus) - present}"


def test_the_three_named_unreadable_reasons_are_represented() -> None:
    """Glare, blur, and angle are the three the build plan names for phase 3."""
    present = {f.expected.unreadable_reason for f in MANIFEST.items if f.expected.unreadable_reason}
    assert present == {UnreadableReason.GLARE, UnreadableReason.BLUR, UnreadableReason.ANGLE}


# Every pairing the corpus is built to exercise. Listed rather than derived, so
# that deleting a fixture reports as lost coverage instead of quietly shrinking
# what the evaluation set proves.
REQUIRED_COVERAGE = {
    (FieldName.BRAND_NAME, Verdict.MATCH),
    (FieldName.BRAND_NAME, Verdict.NEEDS_REVIEW),
    (FieldName.BRAND_NAME, Verdict.MISMATCH),
    (FieldName.CLASS_TYPE, Verdict.MATCH),
    (FieldName.CLASS_TYPE, Verdict.MISMATCH),
    (FieldName.ALCOHOL_CONTENT, Verdict.MATCH),
    (FieldName.ALCOHOL_CONTENT, Verdict.NEEDS_REVIEW),
    (FieldName.ALCOHOL_CONTENT, Verdict.MISMATCH),
    (FieldName.NET_CONTENTS, Verdict.MATCH),
    (FieldName.NET_CONTENTS, Verdict.MISMATCH),
    (FieldName.BOTTLER_INFO, Verdict.MATCH),
    (FieldName.BOTTLER_INFO, Verdict.NEEDS_REVIEW),
    (FieldName.BOTTLER_INFO, Verdict.MISMATCH),
    (FieldName.COUNTRY_OF_ORIGIN, Verdict.MATCH),
    (FieldName.COUNTRY_OF_ORIGIN, Verdict.MISMATCH),
    (FieldName.GOVERNMENT_WARNING, Verdict.MATCH),
    (FieldName.GOVERNMENT_WARNING, Verdict.NEEDS_REVIEW),
    (FieldName.GOVERNMENT_WARNING, Verdict.MISMATCH),
}


def test_the_corpus_covers_every_intended_field_and_verdict_pairing() -> None:
    covered = {
        (field.field, field.verdict) for fixture in MANIFEST.items for field in fixture.expected.fields
    }
    assert REQUIRED_COVERAGE <= covered, f"lost coverage: {REQUIRED_COVERAGE - covered}"


def test_every_fixture_records_what_it_probes() -> None:
    """A fixture nobody can explain is a fixture nobody can maintain."""
    for fixture in MANIFEST.items:
        assert len(fixture.probes) > 20, f"{fixture.id}: probes note is too thin"
        for field in fixture.expected.fields:
            assert len(field.note) > 20, f"{fixture.id}/{field.field.value}: note is too thin"
