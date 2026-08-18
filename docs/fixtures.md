# Fixture Corpus

The 44 synthetic labels that seed the demo queue, back the engine tests, and
serve as the evaluation set. Built once and used three ways, so the queue an
evaluator clicks through is the same data the accuracy numbers come from.

Design rationale is in [approach.md](./approach.md) section 5.8, structure in
[architecture.md](./architecture.md), the constants the engine relies on in
[assumptions.md](./assumptions.md), and the sequence of work in
[build-plan.md](./build-plan.md).

---

## 1. The rule that makes this an evaluation set

**Expected verdicts are authored by hand, per fixture, and never computed by
running the engine.**

Each fixture states what each field should be graded as and why, written from
the regulation rather than from the code. `tests/test_seed_expectations.py` then
runs the engine against every fixture and asserts it agrees. Deriving the
expectations from `verify()` would produce a suite incapable of ever failing,
which is exactly the difference between an evaluation set and a pile of sample
data.

When an expectation and the engine disagree, one of the two is wrong. The `note`
on the expectation says what the fixture was built to prove, which is where to
start reading.

---

## 2. What is in the corpus

44 fixtures: 24 defect and edge cases, 20 straightforward passing labels.

By outcome:

| Expected status | Count |
| --- | --- |
| `looks_correct` | 24 |
| `needs_review` | 6 |
| `problem_found` | 11 |
| `unreadable` | 3 |

The clean majority is deliberate. A queue where half the items are violations
misrepresents the job, and `test_the_queue_is_mostly_clean` keeps it that way as
the corpus grows.

Four of the 24 edge cases are expected to **pass**. An edge case that correctly
clears is as much a regression risk as one that correctly fails, and the
`STONE'S THROW` case is a named requirement rather than a defect.

### Defect and edge cases

| Fixture | What it probes | Expected |
| --- | --- | --- |
| `case-variance` | All-caps plus a curly apostrophe, the named requirement | `looks_correct` |
| `brand-fuzzy-review` | A one-character transcription slip | `needs_review` |
| `brand-name-mismatch` | A brand extension is a different product | `problem_found` |
| `class-type-mismatch` | Blended whiskey declared as straight bourbon | `problem_found` |
| `abv-mismatch-spirits` | 5 points apart on a 0.3 point band | `problem_found` |
| `abv-within-band-wine` | Inside the band, so a review and not a pass | `needs_review` |
| `abv-wine-tax-boundary` | 0.2 points apart, still hard, 14% separates tax classes | `problem_found` |
| `proof-contradiction` | The label disagrees with itself before the application is read | `problem_found` |
| `net-contents-compound` | `1 PINT 8 FL. OZ.` summed against 709 mL | `looks_correct` |
| `net-contents-restated` | `750 mL (25.4 fl oz)` is one volume said twice | `looks_correct` |
| `net-contents-mismatch` | 750 against 700, outside the rounding slack | `problem_found` |
| `address-saint-and-street` | Both senses of `St` in one address | `looks_correct` |
| `address-directional` | A directional with no house number. See section 7 | `needs_review` |
| `bottler-address-mismatch` | A different company in a different state | `problem_found` |
| `import-missing-country` | Conditional field, required because it is an import | `problem_found` |
| `warning-missing` | No health warning at all | `problem_found` |
| `warning-title-case` | Right wording, wrong capitalization | `problem_found` |
| `warning-altered-wording` | One verb changed, exercises the word-level diff | `problem_found` |
| `warning-not-bold` | Prefix weight, graded softly per ADR-005 | `needs_review` |
| `warning-remainder-bold` | The other half of the bold rule | `needs_review` |
| `warning-undersized` | 1mm on a 750 mL bottle | `needs_review` |
| `unreadable-glare` / `-blur` / `-angle` | Three distinct reasons, no field verdicts at all | `unreadable` |

### The clean twenty

Chosen to walk the parameter space rather than to pad a count: all three
beverage classes, all three type-size bands from 27 CFR 16.22(b), imports
alongside domestic products, and both unit systems for net contents.

All brand names are invented. The repository is public and nothing here should
read as a claim about a real product.

---

## 3. Why synthetic, and why rendered

Rendering rather than photographing is what makes ground truth possible.

The two signals [assumptions.md](./assumptions.md) section 8 flags as least
reliable are millimetre type size and bold detection, both estimated from a
photograph. A real label photograph carries neither as data: somebody would have
to measure the print and guess at the weight. A rendered label carries both
exactly, because the generator drew the warning at 2.2mm with the bold face or
it did not.

That turns a soft-graded check into something measurable. Phase 8 can report how
far the model's millimetre estimate lands from a number nobody had to guess.

The trade is that a rendered label is cleaner than a phone photograph, which is
what section 5 addresses.

---

## 4. Rendering

**Geometry.** Fixed at 10 pixels per millimetre, giving a 90 x 120mm label on a
900 x 1200 canvas. 1200 on the longest edge is exactly what the phase 4
client-side downscale produces, so a fixture is already the shape of a real
upload rather than something that gets resized on the way in.

**Type size is read as cap height.** 27 CFR 16.22(b) states a minimum in
millimetres without saying where it is measured from. The renderer treats it as
the height of a capital letter and solves for the font size that lands on the
requested value, rather than assuming a ratio. This is a judgement and it is
recorded here because it is not a citation. If TTB measures type size some other
way, `font_for_cap_height` in `tools/fixtures/render.py` is the one place that
changes.

**The warning is never shrunk to fit.** Everything else on the label gives way
first. A 3mm warning on a 5 litre container is tall enough to collide with the
bottler line, and the thing that must not move is the statement whose size is
under test. `clean-wine-box-5l` is that case.

**Fonts are vendored.** DejaVu Sans regular and bold live in `backend/tools/fonts`
under their Bitstream licence. Relying on system fonts would make the output
differ between machines and silently break the determinism check.

**Generation is deterministic.** Every random effect is seeded from the fixture
id, so regenerating produces byte-identical files and the committed images never
churn in a diff.

---

## 5. Degradation, and one honest caveat

Six passing fixtures carry a mild `photo` pass: slight perspective, paper grain,
uneven lighting, a touch of blur. Without it the whole corpus would be pristine
synthetic text, which `gpt-4.1-mini` reads far better than it reads a label
photographed on a desk, and the phase 8 accuracy numbers would be flattered by
input no real user produces.

Three fixtures carry a severe pass and exist to be unreadable: `glare`, `blur`,
and `angle`.

**Their severity is a dial, not a measurement.** Whether they actually defeat
the model is not knowable until phase 4 puts a real extraction call behind them.
The constants at the top of `tools/fixtures/degrade.py` are what gets turned up
if the model reads them anyway. This is recorded rather than solved because
guessing at it now would be inventing evidence.

### What phase 4 found

One of the three works. `unreadable-blur` is reported unreadable, with `blur` as
the reason, and verifies to the `unreadable` status as intended.

`unreadable-glare` and `unreadable-angle` are read anyway, and the way they fail
is worse than the failure itself. On both, the model returned the *statutory*
government warning in full, confidently, from a label whose warning is not
legible in the image. It is reconstructing the text it expects rather than
transcribing the text it can see.

That is worth separating from the good news next to it, because the same run
confirmed the model does *not* repair an altered warning it can actually read:
`warning-altered-wording` and `warning-title-case` both come back transcribed
faithfully. So the reconstruction is specifically what happens when the pixels
stop supporting a reading, which is exactly the condition these two fixtures
exist to create.

The dial is the documented response and turning it up is the obvious next step.
It is deliberately not done yet, for one reason: the corpus is committed binary
data and the phase 8 accuracy numbers are taken against it, so regenerating two
images to make a measurement come out differently is a change that should be made
deliberately and recorded, not slipped in while fixing something else. What is
recorded here instead is that two of the three degraded fixtures do not currently
do their job, and why that matters more than the count suggests.

---

## 6. The manifest and what the API serves

`backend/fixtures/manifest.json` is committed and carries, per fixture: the
application record, the ground-truth extraction, the expected verdicts with
their justifications, and the image and thumbnail paths.

`GET /api/seed/queue` serves a strict subset:

| Served | Withheld |
| --- | --- |
| id, application reference, brand name | expected verdicts and their notes |
| status, always `not_yet_checked` | the ground-truth extraction |
| image and thumbnail URLs | what the fixture probes |
| the full application record | |

Two reasons. The corpus is the evaluation set, so the grading stays server-side.
And items load unverified because the evaluator triggers verification and
watches it run, which is what makes the latency claim visible instead of
asserted. Pre-computing verdicts would make the demo faster and prove nothing.

Fixture ids are descriptive on purpose and appear in the image URLs, so
`abv-mismatch-spirits` is visible to anyone reading the network tab. They are
not treated as secret. The model never sees an id, only an image, so this does
not affect the phase 8 measurement; it only means a determined evaluator can
spoil their own demo.

Static mounts serve the images and thumbnails. Review state lives in the
browser, so every evaluator starts on an identical queue with no server-side
state to reset.

---

## 7. Regenerating

```bash
cd backend && uv sync --group fixtures && uv run python -m tools.generate_fixtures
```

Pillow sits in its own `fixtures` dependency group rather than in `dev`, so CI
installs only what it needs and Render's `uv sync --frozen --no-dev` build never
sees an image library. The images are committed precisely so that deployment
never runs a generation step.

`tests/test_seed_manifest.py` rebuilds the manifest from the specs in memory and
compares it against the committed file, so editing a spec without regenerating
fails the build. That check needs no Pillow, which is why `manifest.py` and
`render.py` are separate modules.

`--manifest-only` rewrites the JSON without touching the images.

---

## 8. What this corpus closed, and what it did not

Against the gap table in [assumptions.md](./assumptions.md) section 8:

| Gap | Now |
| --- | --- |
| `beverage_class` defaulting silently | **Closed.** Every seed record sets it, enforced by a test. |
| The `St` position rule | **Closed.** `address-saint-and-street` carries both senses in one address and passes. |
| Type size and bold estimated from a photograph | **Measurable.** Fixtures now carry exact rendered values, so phase 4 can compare the model's estimate against them instead of against an opinion. |
| Directionals expand only in a numbered street line | **Open.** See below. |
| Compound volumes detected by descending size | **Covered in the passing direction** by `net-contents-compound` and `net-contents-restated`. A label writing the smaller part first still has no fixture. |
| Every threshold unvalidated | **Still phase 8.** The corpus is the input to that measurement, not the measurement. |
| Degraded fixtures actually defeat the model | **Answered, and only partly well.** Blur works; glare and angle do not. See section 5. |

### The directional finding

`address-directional` pairs `North Main St` on the application against
`N Main St` on the label, on a street line carrying no house number.

The ideal verdict is `match`: these are the same street. The engine returns
`needs_review`, because a directional abbreviation only expands inside a segment
that begins with a house number, and this one does not. The fixture records
`needs_review` as its expectation, which is worth being explicit about since it
is the one place the corpus pins current behaviour rather than ideal behaviour.

The reasoning: routing an address that differs in printed form to a human is a
defensible outcome, not a wrong one, and approach.md section 5.3 asks for a bias
toward review on addresses specifically. Failing safe is different from failing.
If the positional rule improves later, this expectation changes to `match` and
the fixture proves the improvement.
