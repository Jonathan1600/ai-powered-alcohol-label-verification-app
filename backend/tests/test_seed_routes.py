"""The read-only seed endpoint, including what it must refuse to say.

Two of these matter more than the rest. Items must arrive unverified, because a
pre-computed queue would make the demo faster and prove nothing. And the
expected verdicts must not leave the server, because the same corpus is the
evaluation set.
"""

import json

from fastapi.testclient import TestClient

from app.main import app
from app.seed.loader import load_manifest

client = TestClient(app)
MANIFEST = load_manifest()


def test_the_queue_returns_every_fixture() -> None:
    response = client.get("/api/seed/queue")
    assert response.status_code == 200

    payload = response.json()
    assert payload["count"] == MANIFEST.count == len(payload["items"])
    assert [item["id"] for item in payload["items"]] == [f.id for f in MANIFEST.items]


def test_every_item_arrives_unverified() -> None:
    """approach.md section 5.8: the evaluator triggers verification and watches it run."""
    items = client.get("/api/seed/queue").json()["items"]
    assert {item["status"] for item in items} == {"not_yet_checked"}


def test_the_queue_carries_the_claimed_application_fields() -> None:
    """Phase 4's verify endpoint takes the claim from the client alongside the image."""
    first = client.get("/api/seed/queue").json()["items"][0]
    application = first["application"]
    for key in ("brand_name", "class_type", "alcohol_content", "net_contents", "bottler_info"):
        assert application[key], f"{key} missing from the queue payload"
    assert application["beverage_class"] in {"wine", "distilled_spirits", "malt_beverage"}


PUBLIC_KEYS = {
    "id",
    "application_reference",
    "brand_name",
    "status",
    "image_url",
    "thumbnail_url",
    "application",
}


def test_the_queue_exposes_only_the_public_fields() -> None:
    for item in client.get("/api/seed/queue").json()["items"]:
        assert set(item) == PUBLIC_KEYS, f"{item['id']}: unexpected keys {set(item) - PUBLIC_KEYS}"


def test_the_graded_answers_never_leave_the_server() -> None:
    """The corpus is also the evaluation set, so the grading stays server-side.

    Fixture ids are descriptive on purpose and appear in the image URLs, so they
    are not treated as secret; a developer reading `abv-mismatch-spirits` in the
    network tab learns what the fixture is for. What must not travel is the
    graded answer: the expected verdicts, the notes justifying them, and the
    ground-truth extraction the model is scored against.
    """
    body = json.dumps(client.get("/api/seed/queue").json())

    assert "ground_truth" not in body
    for fixture in MANIFEST.items:
        assert fixture.probes not in body, f"{fixture.id}: leaked what it probes"
        for field in fixture.expected.fields:
            assert field.note not in body, f"{fixture.id}: leaked a grading note"


def test_image_and_thumbnail_urls_resolve() -> None:
    for item in client.get("/api/seed/queue").json()["items"]:
        image = client.get(item["image_url"])
        assert image.status_code == 200, item["image_url"]
        assert image.headers["content-type"] == "image/png"

        thumbnail = client.get(item["thumbnail_url"])
        assert thumbnail.status_code == 200, item["thumbnail_url"]
        assert thumbnail.headers["content-type"] == "image/jpeg"
        assert len(thumbnail.content) < len(image.content)


def test_the_health_check_still_works() -> None:
    """Mounting static files under /api/seed must not shadow the existing routes."""
    assert client.get("/api/health").json()["status"] == "ok"
