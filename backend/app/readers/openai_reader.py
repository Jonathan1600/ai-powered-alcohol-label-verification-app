"""The `LabelReader` that actually calls `gpt-4.1-mini`. See ADR-002 and ADR-008.

One call, structured outputs, no chain and no retries. The reasoning for each of
those is in approach.md section 6: a chain multiplies the latency budget, and a
retry hides inside the measurement, turning a timing regression into a number
nobody can interpret. A failed call is reported as a failure.

Two failure modes are kept strictly apart. An *unreadable label* is a finding:
the model looked and could not read the image, and that flows through the
contract to a real outcome the agent sees. An *extraction failure* is our
problem: a timeout, a refusal, a transport error. Collapsing the second into the
first would let an outage present itself to a reviewer as a bad photograph, so
extraction failures raise instead.
"""

import base64
from functools import lru_cache

from openai import APIError, APITimeoutError, OpenAI

from app.config import Settings
from app.matching.contracts import ExtractedLabel
from app.readers.prompt import SYSTEM_PROMPT, USER_PROMPT
from app.readers.schema import LabelObservation, to_contract

# Enough for the full contract with the warning transcribed in full, which
# measured around 255 output tokens, plus room for a long altered warning. The
# cap is a guard against a runaway generation, not a tuning knob: truncation is
# raised rather than salvaged, because half a warning is worse than no answer.
MAX_OUTPUT_TOKENS = 900

_MIME_BY_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)


class ExtractionError(RuntimeError):
    """The model could not be asked, or did not answer usably.

    Distinct from an unreadable label, which is a successful extraction whose
    content happens to be "I cannot read this".
    """


def sniff_mime(image: bytes) -> str:
    """Identify the image type from its magic bytes.

    The data URL has to name a type and the reader is handed raw bytes, so the
    bytes are asked rather than trusting a client-supplied content type that the
    endpoint has already validated separately.
    """
    for magic, mime in _MIME_BY_MAGIC:
        if image.startswith(magic):
            return mime
    raise ExtractionError(
        "Unrecognised image format. Expected PNG, JPEG, or WebP."
    )


class OpenAILabelReader:
    """Reads a label with one structured-output call to `gpt-4.1-mini`."""

    def __init__(
        self,
        client: OpenAI | None = None,
        model: str = "gpt-4.1-mini",
        max_output_tokens: int = MAX_OUTPUT_TOKENS,
    ) -> None:
        self._client = client or OpenAI()
        self._model = model
        self._max_output_tokens = max_output_tokens

    def read(self, image: bytes) -> ExtractedLabel:
        """Extract what the label says. Raises `ExtractionError` if it cannot."""
        data_url = f"data:{sniff_mime(image)};base64,{base64.b64encode(image).decode()}"

        try:
            response = self._client.responses.parse(
                model=self._model,
                input=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": USER_PROMPT},
                            {"type": "input_image", "image_url": data_url, "detail": "high"},
                        ],
                    },
                ],
                text_format=LabelObservation,
                max_output_tokens=self._max_output_tokens,
            )
        except APITimeoutError as error:
            raise ExtractionError("The extraction request timed out.") from error
        except APIError as error:
            raise ExtractionError(f"The extraction request failed: {error}") from error

        observation = response.output_parsed
        if observation is None:
            # A refusal or a truncated generation. `incomplete_details` names
            # which, and it is worth surfacing: a max-token truncation is our bug
            # and a refusal is not.
            detail = getattr(response, "incomplete_details", None)
            raise ExtractionError(
                f"The model returned no usable extraction (status {response.status}"
                f"{f', {detail.reason}' if detail else ''})."
            )

        return to_contract(observation)


@lru_cache(maxsize=1)
def _shared_client(timeout: float, max_retries: int) -> OpenAI:
    """One long-lived client for the whole process.

    Not merely tidy. Phase 4 measurement showed the first call through a fresh
    client paying several seconds more than the ones after it, so a client built
    per request would hand every single request the cold-connection cost. The
    connection pool staying warm is worth more here than anything in the prompt.
    """
    return OpenAI(timeout=timeout, max_retries=max_retries)


def build_reader(settings: Settings) -> OpenAILabelReader:
    """The reader the application uses, over the shared client."""
    return OpenAILabelReader(
        client=_shared_client(settings.openai_timeout_seconds, settings.openai_max_retries),
        model=settings.openai_model,
    )


__all__ = ["ExtractionError", "OpenAILabelReader", "build_reader", "sniff_mime"]
