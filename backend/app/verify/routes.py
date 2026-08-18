"""`POST /api/verify`: one label, one extraction, one set of verdicts.

The endpoint owns the boundary work and nothing else. It validates what arrived,
hands the bytes to a `LabelReader`, hands the reading to the matching engine, and
times each stage. Every judgement lives in `app.matching` and every model detail
lives in `app.readers`, so this module stays readable and the pieces either side
of it stay testable without it.

The reader arrives by dependency injection, which is what lets the whole endpoint
be covered offline against `MockLabelReader`. Phase 2's promise that the suite
runs with no API key present survives the arrival of a real network call.
"""

import json
import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.matching import verify as run_matching
from app.matching.contracts import ApplicationRecord
from app.readers import LabelReader
from app.readers.openai_reader import ExtractionError, build_reader
from app.readers.prompt import PROMPT_VERSION
from app.verify.models import StageTimings, VerifyResponse

router = APIRouter(prefix="/api", tags=["verify"])

# A client that has downscaled to 1200px on the longest edge sends a couple of
# hundred kilobytes. The cap is set well above that so an unprocessed photo from
# a phone still succeeds rather than failing in a way an agent cannot act on,
# while still refusing anything that is clearly not a label photo.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

ALLOWED_CONTENT_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})


def get_reader(settings: Annotated[Settings, Depends(get_settings)]) -> LabelReader:
    """The reader used in production. Overridden in tests with the mock."""
    return build_reader(settings)


def _parse_application(raw: str) -> ApplicationRecord:
    """Read the claimed values out of the multipart form.

    They travel as a JSON string in a form field rather than as a JSON body,
    because the image shares the request and multipart is the only shape that
    carries both. A parse failure is the client's bug and says so.
    """
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=422,
            detail=f"The application field is not valid JSON: {error}",
        ) from error

    try:
        return ApplicationRecord.model_validate(payload)
    except ValidationError as error:
        raise HTTPException(
            status_code=422,
            detail=f"The application record is incomplete or malformed: {error}",
        ) from error


@router.post("/verify", response_model=VerifyResponse)
async def verify_label(
    image: Annotated[UploadFile, File(description="The label photograph.")],
    application: Annotated[str, Form(description="The claimed application record, as JSON.")],
    reader: Annotated[LabelReader, Depends(get_reader)],
) -> VerifyResponse:
    """Verify one label against one application record."""
    started = time.perf_counter()

    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported image type {image.content_type!r}. "
                f"Send PNG, JPEG, or WebP."
            ),
        )

    record = _parse_application(application)

    read_started = time.perf_counter()
    data = await image.read()
    read_ms = (time.perf_counter() - read_started) * 1000

    if not data:
        raise HTTPException(status_code=422, detail="The uploaded image is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"The image is {len(data) // 1024}KB, over the "
                f"{MAX_IMAGE_BYTES // 1024}KB limit. Downscale before uploading."
            ),
        )

    # The extraction call is blocking, and blocking the event loop would serialise
    # every concurrent verification. Phase 7 runs these 5 to 8 at a time, so the
    # threadpool hop is what makes that possible rather than an optimisation.
    model_started = time.perf_counter()
    try:
        extraction = await run_in_threadpool(reader.read, data)
    except ExtractionError as error:
        # 502, not 500: the failure is upstream, and the distinction tells an
        # operator whether to look at our logs or at the provider's status page.
        raise HTTPException(status_code=502, detail=str(error)) from error
    model_ms = (time.perf_counter() - model_started) * 1000

    matching_started = time.perf_counter()
    result = run_matching(record, extraction)
    matching_ms = (time.perf_counter() - matching_started) * 1000

    return VerifyResponse(
        result=result,
        timings=StageTimings(
            read_ms=read_ms,
            model_ms=model_ms,
            matching_ms=matching_ms,
            server_total_ms=(time.perf_counter() - started) * 1000,
        ),
        model=get_settings().openai_model,
        prompt_version=PROMPT_VERSION,
        image_bytes=len(data),
    )
