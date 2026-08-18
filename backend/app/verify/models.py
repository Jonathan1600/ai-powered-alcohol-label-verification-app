"""What the verify endpoint returns, including what the timings actually mean.

The elapsed numbers are the point of this endpoint as much as the verdicts are.
approach.md section 6 makes latency a hard requirement rather than a target, and
a requirement measured loosely is not enforced at all, so the field names below
are chosen to say exactly what was and was not observed.
"""

from pydantic import BaseModel, Field

from app.matching.contracts import VerificationResult


class StageTimings(BaseModel):
    """Server-side elapsed milliseconds, by stage.

    Deliberately *not* the number in the requirement. The 5 second budget is
    measured from the user's submit to the result on screen, and a server cannot
    see the client's downscale, the upload over the wire, or the render. Those
    stages belong to the browser and are added there.

    Naming this `total_ms` and letting it be quoted as the user-facing latency
    would understate the real number by the whole network round trip, so what
    the server can honestly claim is scoped here and labelled.
    """

    read_ms: float = Field(description="Reading the uploaded bytes out of the request.")
    model_ms: float = Field(description="The extraction call, the dominant term.")
    matching_ms: float = Field(description="The deterministic engine. Expected under 50ms.")
    server_total_ms: float = Field(
        description=(
            "Time inside the request handler. Excludes upload transfer, client "
            "downscale, and render, which the browser measures."
        )
    )


class VerifyResponse(BaseModel):
    """One verification, its timings, and what produced it."""

    result: VerificationResult
    timings: StageTimings
    model: str
    # Carried so an evaluation run can attribute a result to the prompt that
    # produced it. Accuracy moves when the prompt moves, and ADR-008 leaves the
    # prompt as the only accuracy lever available.
    prompt_version: str
    image_bytes: int


__all__ = ["StageTimings", "VerifyResponse"]
