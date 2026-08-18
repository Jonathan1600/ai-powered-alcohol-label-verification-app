"""Draws a fixture spec into a label image.

The point of rendering rather than photographing is ground truth. When the
generator draws the health warning at a 2.2mm cap height, the label genuinely
carries 2.2mm type, and phase 8 can measure how close the model's estimate comes
to a number nobody had to guess. The same goes for bold: the prefix is drawn
with the bold face or it is not.

**Type size interpretation.** 27 CFR 16.22(b) states a minimum in millimetres
without defining where it is measured from. This renderer treats it as cap
height, the height of a capital letter, which is the reading TTB guidance
follows, and sizes the font so that `bbox("H")` lands on the requested value.
The interpretation is recorded in docs/fixtures.md because it is a judgement,
not a citation.

Geometry is fixed at 10 pixels per millimetre, giving a 90 x 120mm label on a
900 x 1200 canvas. 1200 on the longest edge is exactly what the phase 4
client-side downscale produces, so a fixture is already the shape of a real
upload.
"""

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.matching.contracts import FieldName
from app.matching.warning import REQUIRED_PREFIX
from tools.fixtures.degrade import apply_degradation
from tools.fixtures.specs import Degradation, LabelSpec

PX_PER_MM = 10
LABEL_WIDTH = 900
LABEL_HEIGHT = 1200
MARGIN = 70

THUMBNAIL_LONGEST_EDGE = 300
THUMBNAIL_QUALITY = 80

FONT_DIR = Path(__file__).resolve().parents[1] / "fonts"
REGULAR_FONT = FONT_DIR / "DejaVuSans.ttf"
BOLD_FONT = FONT_DIR / "DejaVuSans-Bold.ttf"


@dataclass(frozen=True)
class Palette:
    """One label's colour scheme. Rotated so the queue is not forty grey cards."""

    background: tuple[int, int, int]
    panel: tuple[int, int, int]
    ink: tuple[int, int, int]
    accent: tuple[int, int, int]


PALETTES: tuple[Palette, ...] = (
    Palette((244, 240, 230), (255, 253, 248), (32, 30, 26), (138, 106, 52)),
    Palette((232, 236, 238), (252, 253, 254), (26, 33, 38), (46, 90, 122)),
    Palette((238, 234, 240), (253, 251, 255), (34, 26, 38), (104, 64, 122)),
    Palette((236, 242, 235), (251, 254, 250), (24, 34, 24), (58, 106, 62)),
    Palette((246, 238, 234), (255, 251, 248), (38, 28, 24), (150, 74, 48)),
    Palette((240, 238, 228), (254, 253, 246), (30, 30, 22), (118, 110, 40)),
    Palette((234, 238, 244), (250, 252, 255), (22, 28, 38), (40, 72, 128)),
    Palette((244, 236, 240), (255, 250, 253), (36, 24, 32), (132, 52, 92)),
    Palette((238, 240, 236), (252, 254, 251), (28, 32, 28), (70, 88, 66)),
    Palette((246, 242, 232), (255, 252, 244), (36, 32, 22), (146, 112, 36)),
    Palette((230, 238, 240), (248, 253, 254), (20, 32, 34), (36, 100, 108)),
    Palette((242, 236, 244), (253, 250, 255), (32, 24, 36), (92, 60, 132)),
)


def palette_for(spec: LabelSpec) -> Palette:
    return PALETTES[spec.palette % len(PALETTES)]


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def font_for_cap_height(path: Path, cap_height_px: float) -> ImageFont.FreeTypeFont:
    """The font size whose capital letters stand `cap_height_px` tall.

    DejaVu's cap height is a fixed fraction of the em, so one estimate plus one
    correction lands exactly. Solving it rather than assuming a ratio keeps the
    rendered millimetres honest, which is the entire reason these fixtures can
    grade a type-size check at all.
    """
    estimate = max(4, round(cap_height_px / 0.73))
    font = _font(path, estimate)
    for _ in range(6):
        top, bottom = font.getbbox("H")[1], font.getbbox("H")[3]
        actual = bottom - top
        if abs(actual - cap_height_px) < 0.5:
            break
        estimate = max(4, estimate + (1 if actual < cap_height_px else -1))
        font = _font(path, estimate)
    return font


def font_to_fit(
    draw: ImageDraw.ImageDraw,
    path: Path,
    text: str,
    cap_height_px: float,
    max_width: int,
    minimum_mm: float = 2.6,
) -> ImageFont.FreeTypeFont:
    """The requested size, or the largest smaller one that fits the label width.

    Brand names run from `Kurogane` to `Stonebridge Ridge`, so a single display
    size either clips the long ones or wastes the short ones. Only decorative
    text is fitted this way. The health warning is never shrunk to fit, because
    its size is the regulated quantity under test.
    """
    floor = minimum_mm * PX_PER_MM
    height = cap_height_px
    font = font_for_cap_height(path, height)
    while height > floor and draw.textlength(text, font=font) > max_width:
        height -= 2
        font = font_for_cap_height(path, height)
    return font


def _wrap(
    draw: ImageDraw.ImageDraw,
    words: list[tuple[str, ImageFont.FreeTypeFont]],
    max_width: int,
) -> list[list[tuple[str, ImageFont.FreeTypeFont]]]:
    """Greedy wrap over words that may each carry a different font.

    The warning needs this: its opening words are bold and its remainder is not,
    and the line break can fall anywhere, so wrapping cannot assume one face.
    """
    lines: list[list[tuple[str, ImageFont.FreeTypeFont]]] = [[]]
    width = 0.0
    for word, font in words:
        piece = word if not lines[-1] else " " + word
        piece_width = draw.textlength(piece, font=font)
        if lines[-1] and width + piece_width > max_width:
            lines.append([(word, font)])
            width = draw.textlength(word, font=font)
        else:
            lines[-1].append((word, font))
            width += piece_width
    return [line for line in lines if line]


def _draw_runs(
    draw: ImageDraw.ImageDraw,
    lines: list[list[tuple[str, ImageFont.FreeTypeFont]]],
    x: int,
    y: float,
    line_height: float,
    fill: tuple[int, int, int],
) -> float:
    """Draw wrapped mixed-font lines, returning the y below the last one."""
    for line in lines:
        cursor = float(x)
        for index, (word, font) in enumerate(line):
            piece = word if index == 0 else " " + word
            draw.text((cursor, y), piece, font=font, fill=fill)
            cursor += draw.textlength(piece, font=font)
        y += line_height
    return y


def _centered(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    y: float,
    fill: tuple[int, int, int],
    width: int = LABEL_WIDTH,
) -> float:
    """Draw one centered line, returning the y below it."""
    text_width = draw.textlength(text, font=font)
    draw.text(((width - text_width) / 2, y), text, font=font, fill=fill)
    return y + (font.getbbox("Hy")[3] - font.getbbox("Hy")[1]) * 1.35


def _warning_words(spec: LabelSpec) -> list[tuple[str, ImageFont.FreeTypeFont]]:
    """Split the warning into words, each tagged with the face it renders in.

    The prefix and the remainder are weighted independently because 27 CFR
    16.22(a) makes them two separate requirements, and a fixture has to be able
    to violate either one alone.
    """
    warning = spec.warning
    cap_height = (warning.type_size_mm or 2.0) * PX_PER_MM
    regular = font_for_cap_height(REGULAR_FONT, cap_height)
    bold = font_for_cap_height(BOLD_FONT, cap_height)

    prefix_font = bold if warning.prefix_is_bold else regular
    remainder_font = bold if warning.remainder_is_bold else regular

    # The prefix is located in the rendered text rather than assumed, so a
    # title-cased fixture still gets its opening words weighted correctly.
    text = warning.text
    split_at = len(REQUIRED_PREFIX)
    if text[:split_at].upper() != REQUIRED_PREFIX:
        split_at = text.find(":") + 1 if ":" in text else 0

    prefix, remainder = text[:split_at], text[split_at:]
    words = [(word, prefix_font) for word in prefix.split()]
    words += [(word, remainder_font) for word in remainder.split()]
    return words


def _warning_block(
    draw: ImageDraw.ImageDraw, spec: LabelSpec
) -> tuple[list[list[tuple[str, ImageFont.FreeTypeFont]]], float, float]:
    """Wrapped warning lines, their line height, and the height of the block."""
    if not (spec.warning.present and spec.warning.text):
        return [], 0.0, 0.0
    words = _warning_words(spec)
    lines = _wrap(draw, words, LABEL_WIDTH - 2 * MARGIN)
    sample = words[0][1]
    line_height = (sample.getbbox("Hy")[3] - sample.getbbox("Hy")[1]) * 1.5
    return lines, line_height, line_height * len(lines)


TOP_OF_CONTENT = float(MARGIN + 30)


def _draw_content(
    draw: ImageDraw.ImageDraw,
    spec: LabelSpec,
    colours: Palette,
    scale: float,
    *,
    paint: bool,
) -> float:
    """Lay out everything above the warning, returning the y it ends at.

    Runs once to measure and once to paint. `scale` shrinks the decorative text
    and the gaps between sections when a large warning leaves less room; the
    warning itself is never scaled, since its size is the regulated quantity.
    """
    text_width = LABEL_WIDTH - 2 * MARGIN
    y = TOP_OF_CONTENT

    def line(text: str, font: ImageFont.FreeTypeFont, fill: tuple[int, int, int]) -> float:
        height = (font.getbbox("Hy")[3] - font.getbbox("Hy")[1]) * 1.35
        if paint:
            _centered(draw, text, font, y, fill)
        return height

    brand = spec.label_text(FieldName.BRAND_NAME)
    if brand:
        brand_font = font_to_fit(draw, BOLD_FONT, brand, 9.0 * PX_PER_MM * scale, text_width, 4.0)
        y += line(brand, brand_font, colours.ink)

    y += 12 * scale
    class_type = spec.label_text(FieldName.CLASS_TYPE)
    if class_type:
        class_font = font_to_fit(
            draw, REGULAR_FONT, class_type, 4.0 * PX_PER_MM * scale, text_width, 2.8
        )
        for wrapped in _wrap(draw, [(word, class_font) for word in class_type.split()], text_width):
            y += line(" ".join(word for word, _ in wrapped), class_font, colours.accent)

    y += 24 * scale
    if paint:
        draw.line([(MARGIN + 40, y), (LABEL_WIDTH - MARGIN - 40, y)], fill=colours.accent, width=2)
    y += 40 * scale

    detail_font = font_for_cap_height(REGULAR_FONT, 3.4 * PX_PER_MM * scale)
    for field in (FieldName.ALCOHOL_CONTENT, FieldName.NET_CONTENTS):
        value = spec.label_text(field)
        if value:
            y += line(value, detail_font, colours.ink) + 8 * scale

    country = spec.label_text(FieldName.COUNTRY_OF_ORIGIN)
    if country:
        y += 10 * scale
        country_font = font_for_cap_height(BOLD_FONT, 3.0 * PX_PER_MM * scale)
        y += line(f"PRODUCT OF {country.upper()}", country_font, colours.accent)

    bottler = spec.label_text(FieldName.BOTTLER_INFO)
    if bottler:
        y += 30 * scale
        bottler_font = font_for_cap_height(REGULAR_FONT, 2.6 * PX_PER_MM * scale)
        for wrapped in _wrap(draw, [(word, bottler_font) for word in bottler.split()], text_width):
            y += line(" ".join(word for word, _ in wrapped), bottler_font, colours.ink)

    return y


def draw_label(spec: LabelSpec) -> Image.Image:
    """Render the flat artwork for one fixture, before any degradation."""
    colours = palette_for(spec)
    image = Image.new("RGB", (LABEL_WIDTH, LABEL_HEIGHT), colours.background)
    draw = ImageDraw.Draw(image)

    inner = (MARGIN // 2, MARGIN // 2, LABEL_WIDTH - MARGIN // 2, LABEL_HEIGHT - MARGIN // 2)
    draw.rectangle(inner, fill=colours.panel, outline=colours.accent, width=3)

    # The warning is laid out first and given its space unconditionally. A 3mm
    # warning on a 5 litre container is tall enough to collide with the bottler
    # line, and the correct thing to give way is the decorative text, never the
    # statement whose size is being tested.
    lines, line_height, block_height = _warning_block(draw, spec)
    budget = LABEL_HEIGHT - MARGIN - block_height - 40

    natural = _draw_content(draw, spec, colours, 1.0, paint=False)
    scale = 1.0
    if natural > budget:
        scale = max(0.5, (budget - TOP_OF_CONTENT) / (natural - TOP_OF_CONTENT))
    _draw_content(draw, spec, colours, scale, paint=True)

    if lines:
        start = LABEL_HEIGHT - MARGIN - block_height
        _draw_runs(draw, lines, MARGIN, start, line_height, colours.ink)

    return image


def render(spec: LabelSpec) -> Image.Image:
    """The finished fixture image: flat artwork plus whatever degradation applies."""
    image = draw_label(spec)
    if spec.degradation is not Degradation.NONE:
        image = apply_degradation(image, spec.degradation, seed=spec.id)
    return image


def thumbnail(image: Image.Image) -> Image.Image:
    """A queue-sized copy, so the grid does not download forty full labels."""
    copy = image.copy()
    copy.thumbnail((THUMBNAIL_LONGEST_EDGE, THUMBNAIL_LONGEST_EDGE), Image.LANCZOS)
    return copy
