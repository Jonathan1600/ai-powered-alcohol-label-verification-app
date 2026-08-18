"""Turns flat artwork into something closer to a photograph.

Two jobs, and they pull in opposite directions.

`PHOTO` is the mild pass. A corpus of pristine renders would flatter the phase 8
accuracy numbers, because `gpt-4.1-mini` reads crisp synthetic text far better
than it reads a label photographed on a desk. So a subset of the passing
fixtures gets slight perspective, paper grain, and uneven lighting, while
staying comfortably legible.

`GLARE`, `BLUR`, and `ANGLE` are the severe pass, and those three fixtures exist
to be unreadable. **Their severity is a dial, not a measurement.** Whether they
actually defeat the model is not knowable until phase 4 puts a real extraction
call behind them; if the model reads them anyway, the constants here are what
gets turned up.

Every effect is seeded from the fixture id, so regenerating produces identical
bytes and the committed images never churn.
"""

import random

from PIL import Image, ImageEnhance, ImageFilter

# Mild pass. Tuned to look photographed, not to obstruct.
PHOTO_ROTATION_DEG = 1.4
PHOTO_PERSPECTIVE = 0.018
PHOTO_GRAIN_ALPHA = 0.10
PHOTO_LIGHTING_DROP = 0.24

# Severe pass. These are the dial referred to above.
GLARE_BLUR_RADIUS = 2.0
GLARE_CONTRAST = 0.45
BLUR_RADIUS = 11.0
ANGLE_PERSPECTIVE = 0.34
ANGLE_BLUR_RADIUS = 2.6


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting, for the 8x8 perspective system.

    Written out rather than pulling in numpy: this is the only linear algebra in
    the project and an extra dependency for eight equations is a poor trade.
    """
    size = len(vector)
    rows = [row[:] + [vector[index]] for index, row in enumerate(matrix)]

    for column in range(size):
        pivot = max(range(column, size), key=lambda r: abs(rows[r][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        rows[column] = [value / divisor for value in rows[column]]
        for other in range(size):
            if other == column:
                continue
            factor = rows[other][column]
            if factor:
                rows[other] = [
                    value - factor * rows[column][index]
                    for index, value in enumerate(rows[other])
                ]
    return [row[size] for row in rows]


def _perspective_coefficients(
    source: list[tuple[float, float]], target: list[tuple[float, float]]
) -> list[float]:
    """Coefficients mapping output corners back to input corners.

    Pillow's PERSPECTIVE transform is defined in reverse: for each output pixel
    it asks where in the input that pixel came from, so `target` is where the
    corners end up and `source` is where they started.
    """
    matrix = []
    for (sx, sy), (tx, ty) in zip(source, target, strict=True):
        matrix.append([tx, ty, 1, 0, 0, 0, -sx * tx, -sx * ty])
        matrix.append([0, 0, 0, tx, ty, 1, -sy * tx, -sy * ty])
    vector = [value for point in source for value in point]
    return _solve(matrix, vector)


def _perspective(
    image: Image.Image, rng: random.Random, strength: float, background: tuple[int, int, int]
) -> Image.Image:
    """Pull the corners in by a random fraction of the image, one side harder."""
    width, height = image.size
    corners = [(0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))]

    def jitter() -> float:
        return rng.uniform(0.25, 1.0) * strength

    # A photograph taken off-axis foreshortens one side more than the other, so
    # the left and right edges get independent insets rather than a symmetric
    # squeeze that would read as a scale change.
    left_inset = jitter() * height
    right_inset = jitter() * height
    top_inset = jitter() * width * 0.5

    target = [
        (top_inset, left_inset),
        (width - top_inset * 0.4, right_inset * 0.35),
        (float(width), height - right_inset),
        (0.0, height - left_inset * 0.5),
    ]
    coefficients = _perspective_coefficients(corners, target)
    return image.transform(
        (width, height),
        Image.PERSPECTIVE,
        coefficients,
        resample=Image.BICUBIC,
        fillcolor=background,
    )


def _grain(image: Image.Image, rng: random.Random, alpha: float) -> Image.Image:
    """Blend in seeded monochrome noise, standing in for paper texture and sensor grain."""
    width, height = image.size
    noise_bytes = bytes(rng.randrange(96, 160) for _ in range(width * height))
    noise = Image.frombytes("L", (width, height), noise_bytes).convert("RGB")
    return Image.blend(image, noise, alpha)


def _uneven_lighting(image: Image.Image, rng: random.Random, drop: float) -> Image.Image:
    """Darken toward one randomly chosen corner, the way a desk lamp would."""
    width, height = image.size
    from_left = rng.random() < 0.5
    # A coarse gradient scaled up costs a fraction of building it per pixel and
    # is visually identical once blurred by the resize.
    steps = 64
    gradient = Image.new("L", (steps, steps))
    pixels = gradient.load()
    for x in range(steps):
        for y in range(steps):
            distance = ((x if from_left else steps - 1 - x) / steps + y / steps) / 2
            pixels[x, y] = int(255 * (1.0 - drop * distance))
    mask = gradient.resize((width, height), Image.BICUBIC)

    dark = Image.new("RGB", (width, height), (0, 0, 0))
    return Image.composite(image, dark, mask)


def _glare(image: Image.Image, rng: random.Random) -> Image.Image:
    """Blow out a broad specular band across the label face.

    Sized to swallow the middle of the label rather than a corner, because glare
    that misses the text would leave the fixture readable and prove nothing.
    """
    width, height = image.size
    highlight = Image.new("L", (width, height), 0)
    from PIL import ImageDraw

    painter = ImageDraw.Draw(highlight)
    centre_x = width * rng.uniform(0.42, 0.58)
    centre_y = height * rng.uniform(0.42, 0.58)
    radius_x = width * 0.62
    radius_y = height * 0.42
    painter.ellipse(
        [centre_x - radius_x, centre_y - radius_y, centre_x + radius_x, centre_y + radius_y],
        fill=245,
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=min(width, height) * 0.10))

    washed = ImageEnhance.Contrast(image).enhance(GLARE_CONTRAST)
    white = Image.new("RGB", (width, height), (255, 255, 255))
    washed = Image.composite(white, washed, highlight)
    return washed.filter(ImageFilter.GaussianBlur(radius=GLARE_BLUR_RADIUS))


def apply_degradation(image: Image.Image, degradation: str, *, seed: str) -> Image.Image:
    """Apply one named pass. Seeded by fixture id so the output never churns."""
    rng = random.Random(seed)
    background = image.getpixel((2, 2))

    if degradation == "photo":
        result = image.rotate(
            rng.uniform(-PHOTO_ROTATION_DEG, PHOTO_ROTATION_DEG),
            resample=Image.BICUBIC,
            fillcolor=background,
        )
        result = _perspective(result, rng, PHOTO_PERSPECTIVE, background)
        result = _uneven_lighting(result, rng, PHOTO_LIGHTING_DROP)
        result = _grain(result, rng, PHOTO_GRAIN_ALPHA)
        return result.filter(ImageFilter.GaussianBlur(radius=0.6))

    if degradation == "glare":
        result = _perspective(image, rng, PHOTO_PERSPECTIVE, background)
        result = _glare(result, rng)
        return _grain(result, rng, PHOTO_GRAIN_ALPHA)

    if degradation == "blur":
        result = _uneven_lighting(image, rng, PHOTO_LIGHTING_DROP)
        result = result.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
        return _grain(result, rng, PHOTO_GRAIN_ALPHA * 0.5)

    if degradation == "angle":
        result = _perspective(image, rng, ANGLE_PERSPECTIVE, background)
        result = _uneven_lighting(result, rng, PHOTO_LIGHTING_DROP * 1.6)
        result = result.filter(ImageFilter.GaussianBlur(radius=ANGLE_BLUR_RADIUS))
        return _grain(result, rng, PHOTO_GRAIN_ALPHA)

    raise ValueError(f"Unknown degradation: {degradation}")
