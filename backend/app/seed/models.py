"""Shapes for the committed fixture manifest and the queue the API serves.

Two distinct models, deliberately. `SeedFixture` is everything the manifest
holds, including the expected verdicts. `SeedQueueItem` is the strict subset an
agent's browser is allowed to see.

The corpus is also the evaluation set, so the expected verdicts must not travel
to the client. Serving the answers to the thing being measured would make the
phase 8 accuracy numbers meaningless, and an evaluator clicking through the demo
would be reading the key rather than the work.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.matching.contracts import (
    ApplicationRecord,
    ExtractedLabel,
    FieldName,
    OverallStatus,
    UnreadableReason,
    Verdict,
)

# The only status the server ever emits. Queue items load unverified and the
# evaluator triggers verification, which is what makes the latency claim in
# approach.md section 6 visible rather than asserted. Pre-computing verdicts
# would make the demo faster and prove nothing.
SEEDED_STATUS = "not_yet_checked"


class ExpectedFieldResult(BaseModel):
    """The verdict one field should receive, hand-authored in tools/fixtures/specs.py."""

    field: FieldName
    verdict: Verdict
    note: str


class ExpectedResult(BaseModel):
    """The complete correct answer for one fixture."""

    status: OverallStatus
    unreadable_reason: UnreadableReason | None = None
    fields: list[ExpectedFieldResult] = Field(default_factory=list)


class SeedFixture(BaseModel):
    """One manifest entry: demo item, test case, and evaluation sample at once."""

    id: str
    application_reference: str
    brand_name: str
    probes: str
    degradation: str
    image: str
    thumbnail: str
    application: ApplicationRecord
    ground_truth: ExtractedLabel
    expected: ExpectedResult


class SeedManifest(BaseModel):
    version: int
    generator: str
    count: int
    items: list[SeedFixture]


class SeedQueueItem(BaseModel):
    """What the queue screen receives. No verdicts, no ground truth, no answers.

    The full `ApplicationRecord` travels because phase 4's verify endpoint takes
    the claimed values from the client alongside the image.
    """

    id: str
    application_reference: str
    brand_name: str
    status: Literal["not_yet_checked"] = SEEDED_STATUS
    image_url: str
    thumbnail_url: str
    application: ApplicationRecord


class SeedQueue(BaseModel):
    count: int
    items: list[SeedQueueItem]
