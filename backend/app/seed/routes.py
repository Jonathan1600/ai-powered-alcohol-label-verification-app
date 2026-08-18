"""The read-only seed queue endpoint.

One JSON route plus two static mounts. The images are served as files rather
than inlined into the queue payload so the grid can lazy-load thumbnails and the
full label is fetched only when a card is opened.
"""

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles

from app.seed.loader import IMAGE_DIR, THUMBNAIL_DIR, load_manifest
from app.seed.models import SeedFixture, SeedQueue, SeedQueueItem

SEED_PREFIX = "/api/seed"

router = APIRouter(prefix=SEED_PREFIX, tags=["seed"])


def to_queue_item(fixture: SeedFixture) -> SeedQueueItem:
    """Project a fixture down to what the client is allowed to know.

    The expected verdicts, the ground-truth extraction, and the note describing
    what the fixture probes all stay on the server. See `app.seed.models`.
    """
    return SeedQueueItem(
        id=fixture.id,
        application_reference=fixture.application_reference,
        brand_name=fixture.brand_name,
        image_url=f"{SEED_PREFIX}/{fixture.image}",
        thumbnail_url=f"{SEED_PREFIX}/{fixture.thumbnail}",
        application=fixture.application,
    )


@router.get("/queue", response_model=SeedQueue)
def seed_queue() -> SeedQueue:
    """The full seeded queue, every item unverified.

    Order is manifest order, which puts the defect and edge cases first. The
    queue screen sorts by attention needed once verdicts exist, and before that
    there is nothing to sort on.
    """
    manifest = load_manifest()
    return SeedQueue(
        count=manifest.count,
        items=[to_queue_item(fixture) for fixture in manifest.items],
    )


def mount_fixture_files(app: FastAPI) -> None:
    """Serve the label images and thumbnails as static files."""
    app.mount(f"{SEED_PREFIX}/images", StaticFiles(directory=IMAGE_DIR), name="seed-images")
    app.mount(
        f"{SEED_PREFIX}/thumbnails",
        StaticFiles(directory=THUMBNAIL_DIR),
        name="seed-thumbnails",
    )
