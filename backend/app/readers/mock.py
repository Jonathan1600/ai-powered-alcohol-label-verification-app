"""A deterministic `LabelReader` for tests and the offline demo path.

It returns whatever reading it was handed, so a test can describe the label it
wants in one object and get exactly that back. Same bytes in, same extraction
out, no network.

The canned readings live with the tests that use them. The fixture corpus is
phase 3 work and does not belong here.
"""

from app.matching.contracts import ExtractedLabel


class MockLabelReader:
    """Serves pre-built extractions, optionally keyed by image bytes.

    With a `default` it answers every request the same way. With a `by_image`
    mapping it can serve a different reading per image, which is what a batch
    test needs.
    """

    def __init__(
        self,
        default: ExtractedLabel | None = None,
        by_image: dict[bytes, ExtractedLabel] | None = None,
    ) -> None:
        if default is None and not by_image:
            raise ValueError("MockLabelReader needs a default reading or a by_image mapping")
        self._default = default
        self._by_image = by_image or {}
        self.calls: list[bytes] = []

    def read(self, image: bytes) -> ExtractedLabel:
        """Return the reading registered for these bytes, else the default."""
        self.calls.append(image)
        reading = self._by_image.get(image, self._default)
        if reading is None:
            raise KeyError("No reading registered for this image and no default was set")
        # Copy so a caller mutating the result cannot corrupt later reads.
        return reading.model_copy(deep=True)


__all__ = ["MockLabelReader"]
