"""The seam between the engine and whatever reads a label. See ADR-002.

TTB's firewall blocks many outbound domains, and that is what killed features in
the previous vendor pilot. Every model call goes through this one interface so a
self-hosted vision model or an on-premise OCR engine can be dropped in behind it
without the matching engine noticing.

The OpenAI implementation arrives in phase 4. Until then the mock is the only
one, which is also what lets the whole test suite run with no API key.
"""

from typing import Protocol, runtime_checkable

from app.matching.contracts import ExtractedLabel


@runtime_checkable
class LabelReader(Protocol):
    """Turns label image bytes into a structured reading."""

    def read(self, image: bytes) -> ExtractedLabel:
        """Extract what the label literally says.

        Implementations report only what they observe. Deciding whether any of
        it is compliant belongs to `app.matching`, never here.
        """
        ...


__all__ = ["LabelReader"]
