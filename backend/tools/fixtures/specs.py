"""The fixture corpus, authored once and consumed three ways.

Every fixture is defined exactly once here: the text rendered onto the label
image, the typography the renderer actually applies, the paired application
record, and the verdict a correct engine should return for each field.
`manifest.py` projects this into the committed `fixtures/manifest.json`,
`render.py` turns it into PNGs, and the tests assert the engine agrees.

**Expected verdicts are authored by hand and never computed by running the
engine.** Deriving them from `verify()` would make the suite incapable of ever
failing, which is the whole difference between an evaluation set and a pile of
sample data. Where an expectation and the engine disagree, the test fails and
one of the two is wrong.

Nothing here imports Pillow, so the manifest can be rebuilt and diffed in CI
without an image library present. Only `render.py` needs one.
"""

from dataclasses import dataclass
from enum import Enum

from app.matching.contracts import (
    ApplicationRecord,
    BeverageClass,
    FieldName,
    OverallStatus,
    UnreadableReason,
    Verdict,
)
from app.matching.warning import CANONICAL_WARNING

# Short aliases. These tables are read as tables, and the full enum names turn
# every expectation into three lines of noise.
F = FieldName
V = Verdict
S = OverallStatus

# A label field left at this default carries exactly what the application
# claims. Writing `None` instead means the label omits the field altogether,
# which is a different thing and has to stay distinguishable.
SAME = "<same as application>"


class Degradation(str, Enum):
    """Which render pass runs after the flat artwork is drawn.

    `PHOTO` is the mild pass that leaves a label comfortably readable. The other
    three are deliberately severe, and those fixtures are the only ones expected
    to come back unreadable.
    """

    NONE = "none"
    PHOTO = "photo"
    GLARE = "glare"
    BLUR = "blur"
    ANGLE = "angle"


@dataclass(frozen=True)
class WarningSpec:
    """The health warning as it is actually drawn onto the image.

    These are instructions to the renderer, not claims about the label, which is
    exactly what makes them ground truth: `type_size_mm` is the size the text is
    rendered at, not somebody's estimate of it.
    """

    present: bool = True
    text: str = CANONICAL_WARNING
    prefix_is_caps: bool = True
    prefix_is_bold: bool = True
    remainder_is_bold: bool = False
    type_size_mm: float | None = 2.2


NO_WARNING = WarningSpec(present=False, text="", type_size_mm=None)

# Only the prefix changes case. Retyping the whole statement in title case would
# read as a wording failure as well, and this fixture exists to isolate the
# capitalization rule in 27 CFR 16.22(a).
TITLE_CASE_WARNING = CANONICAL_WARNING.replace(
    "GOVERNMENT WARNING:", "Government Warning:", 1
)

# One verb changed, which is the smallest edit that is still unambiguously a
# different statement from the one 27 CFR 16.21 prescribes.
ALTERED_WARNING = CANONICAL_WARNING.replace(
    "may cause health problems", "can cause health problems", 1
)


@dataclass(frozen=True)
class FieldExpectation:
    """The verdict one field should receive, and why."""

    field: FieldName
    verdict: Verdict
    note: str


@dataclass(frozen=True)
class Expectation:
    """The complete correct answer for one fixture.

    `fields` is empty for an unreadable image, because approach.md section 5.4
    makes unreadable a distinct outcome that returns no field verdicts at all.
    """

    status: OverallStatus
    fields: tuple[FieldExpectation, ...] = ()
    unreadable_reason: UnreadableReason | None = None


@dataclass(frozen=True)
class LabelSpec:
    """One fixture: what gets drawn, what was claimed, and what should happen."""

    id: str
    application_reference: str
    probes: str
    application: ApplicationRecord
    expected: Expectation
    label_brand_name: str | None = SAME
    label_class_type: str | None = SAME
    label_alcohol_content: str | None = SAME
    label_net_contents: str | None = SAME
    label_bottler_info: str | None = SAME
    label_country_of_origin: str | None = SAME
    warning: WarningSpec = WarningSpec()
    degradation: Degradation = Degradation.NONE
    # Rotates the rendered colour scheme so the seeded queue does not look like
    # forty copies of one label.
    palette: int = 0

    def label_text(self, field: FieldName) -> str | None:
        """What this field literally reads on the rendered label."""
        claimed = {
            F.BRAND_NAME: self.application.brand_name,
            F.CLASS_TYPE: self.application.class_type,
            F.ALCOHOL_CONTENT: self.application.alcohol_content,
            F.NET_CONTENTS: self.application.net_contents,
            F.BOTTLER_INFO: self.application.bottler_info,
            F.COUNTRY_OF_ORIGIN: self.application.country_of_origin,
        }[field]
        printed = {
            F.BRAND_NAME: self.label_brand_name,
            F.CLASS_TYPE: self.label_class_type,
            F.ALCOHOL_CONTENT: self.label_alcohol_content,
            F.NET_CONTENTS: self.label_net_contents,
            F.BOTTLER_INFO: self.label_bottler_info,
            F.COUNTRY_OF_ORIGIN: self.label_country_of_origin,
        }[field]
        return claimed if printed == SAME else printed

    @property
    def is_unreadable(self) -> bool:
        return self.expected.status is S.UNREADABLE


# --------------------------------------------------------------------------
# Expectation builder
# --------------------------------------------------------------------------

_AGREES = "The label prints exactly what the application claims."

_DEFAULT_NOTES = {
    F.BRAND_NAME: _AGREES,
    F.CLASS_TYPE: _AGREES,
    F.ALCOHOL_CONTENT: _AGREES,
    F.NET_CONTENTS: _AGREES,
    F.BOTTLER_INFO: _AGREES,
    F.COUNTRY_OF_ORIGIN: "An import, and the label states the claimed country of origin.",
    F.GOVERNMENT_WARNING: "Statutory wording, capitalized and bold prefix, legal type size.",
}


def _why(verdict: Verdict, note: str) -> tuple[Verdict, str]:
    """Pair a verdict with the sentence justifying it.

    A plain tuple would do the same job. This exists so the justification can be
    written as one long string across several source lines without ruff reading
    the wrapped literal as a missing comma inside a dict.
    """
    return verdict, note


def _expect(
    status: OverallStatus,
    overrides: dict[FieldName, tuple[Verdict, str]] | None = None,
    *,
    is_import: bool = False,
) -> Expectation:
    """Build a full expectation, stating only the fields that are not clean.

    The field order mirrors `matching.engine.verify`, and country of origin is
    present only for imports, because a domestic product omits the field
    entirely rather than taking a fourth verdict state.
    """
    order = [F.BRAND_NAME, F.CLASS_TYPE, F.ALCOHOL_CONTENT, F.NET_CONTENTS, F.BOTTLER_INFO]
    if is_import:
        order.append(F.COUNTRY_OF_ORIGIN)
    order.append(F.GOVERNMENT_WARNING)

    stated = overrides or {}
    fields = tuple(
        FieldExpectation(name, *stated.get(name, (V.MATCH, _DEFAULT_NOTES[name])))
        for name in order
    )
    return Expectation(status=status, fields=fields)


def _unreadable(reason: UnreadableReason) -> Expectation:
    return Expectation(status=S.UNREADABLE, fields=(), unreadable_reason=reason)


def _clean(
    fixture_id: str,
    reference: str,
    brand: str,
    class_type: str,
    alcohol: str,
    net_contents: str,
    bottler: str,
    beverage_class: BeverageClass,
    *,
    country: str | None = None,
    type_size_mm: float = 2.2,
    degradation: Degradation = Degradation.NONE,
    palette: int = 0,
    label_class_type: str | None = SAME,
    probes: str = "A straightforward passing label.",
) -> LabelSpec:
    """A fixture whose label agrees with its application on every field."""
    return LabelSpec(
        id=fixture_id,
        application_reference=reference,
        probes=probes,
        application=ApplicationRecord(
            brand_name=brand,
            class_type=class_type,
            alcohol_content=alcohol,
            net_contents=net_contents,
            bottler_info=bottler,
            country_of_origin=country,
            beverage_class=beverage_class,
            is_import=country is not None,
        ),
        expected=_expect(S.LOOKS_CORRECT, is_import=country is not None),
        label_class_type=label_class_type,
        warning=WarningSpec(type_size_mm=type_size_mm),
        degradation=degradation,
        palette=palette,
    )


# --------------------------------------------------------------------------
# Defect and edge cases
#
# Each one exists to probe a specific decision in the engine or a specific gap
# recorded in assumptions.md section 8. Four of them are expected to pass: an
# edge case that correctly clears is as much a regression risk as one that
# correctly fails, and the STONE'S THROW case is a named requirement.
# --------------------------------------------------------------------------

DEFECT_SPECS: tuple[LabelSpec, ...] = (
    LabelSpec(
        id="case-variance",
        application_reference="TTB-2026-0001",
        probes=(
            "The named requirement: all-caps plus a curly apostrophe must not "
            "fail. Every field differs in case and none of it means anything."
        ),
        application=ApplicationRecord(
            brand_name="Stone's Throw",
            class_type="Kentucky Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Stone's Throw Distillery, 120 Main St, Bardstown, KY",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(S.LOOKS_CORRECT),
        label_brand_name="STONE’S THROW",
        label_class_type="KENTUCKY STRAIGHT BOURBON WHISKEY",
        label_alcohol_content="45% ALC./VOL. (90 PROOF)",
        label_net_contents="750 ML",
        label_bottler_info=(
            "BOTTLED BY STONE’S THROW DISTILLERY, 120 MAIN STREET, BARDSTOWN, KY"
        ),
        palette=19,
    ),
    LabelSpec(
        id="brand-fuzzy-review",
        application_reference="TTB-2026-0002",
        probes="A one-character transcription slip, which is the fuzzy tier's whole purpose.",
        application=ApplicationRecord(
            brand_name="Ridgeline Reserve",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="46% Alc./Vol. (92 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Ridgeline Distilling Co, 60 Ledge Rd, Asheville, NC",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.BRAND_NAME: _why(
                    V.NEEDS_REVIEW,
                    "Close but not identical. A dropped letter is far more likely to "
                    "be a transcription slip than a different product, so it goes to "
                    "an agent rather than being called a violation.",
                )
            },
        ),
        label_brand_name="Ridgeline Resrve",
        palette=20,
    ),
    LabelSpec(
        id="abv-mismatch-spirits",
        application_reference="TTB-2026-0003",
        probes="5 points apart on a 0.3 point band. 27 CFR 5.65(a)(2).",
        application=ApplicationRecord(
            brand_name="Kilnwright",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Kilnwright Distillery, 14 Cooperage St, Louisville, KY",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.ALCOHOL_CONTENT: _why(
                    V.MISMATCH,
                    "45% claimed against 40% printed. No reading of the 0.3 point "
                    "spirits tolerance forgives a 5 point gap.",
                )
            },
        ),
        label_alcohol_content="40% Alc./Vol. (80 Proof)",
        palette=21,
    ),
    LabelSpec(
        id="abv-within-band-wine",
        application_reference="TTB-2026-0004",
        probes=(
            "The central interpretation in assumptions.md section 3: inside the "
            "band is a review, not a pass and not a violation."
        ),
        application=ApplicationRecord(
            brand_name="Hollowmere",
            class_type="Sauvignon Blanc",
            alcohol_content="12.5% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Hollowmere Vineyards, 5 Bench Rd, Sonoma, CA",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.ALCOHOL_CONTENT: _why(
                    V.NEEDS_REVIEW,
                    "0.5 points apart, inside the 1.5 point band for wine at or "
                    "below 14%. The label would still be lawful for this product, "
                    "but the two documents disagree and only exact agreement passes "
                    "clean.",
                )
            },
        ),
        label_alcohol_content="13% Alc./Vol.",
        palette=22,
    ),
    LabelSpec(
        id="abv-wine-tax-boundary",
        application_reference="TTB-2026-0005",
        probes=(
            "0.2 points apart inside a 1.5 point band, and still a hard mismatch "
            "because the values fall in different tax classes. 27 CFR 4.36(b)(2)."
        ),
        application=ApplicationRecord(
            brand_name="Ashgrove Bend",
            class_type="Zinfandel",
            alcohol_content="13.9% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Ashgrove Bend Winery, 700 Dry Creek Rd, Healdsburg, CA",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.ALCOHOL_CONTENT: _why(
                    V.MISMATCH,
                    "13.9% against 14.1%. The gap is small and the tolerance is "
                    "wide, but the 14% threshold separates two taxable grades and "
                    "no tolerance bridges it.",
                )
            },
        ),
        label_alcohol_content="14.1% Alc./Vol.",
        palette=23,
    ),
    LabelSpec(
        id="proof-contradiction",
        application_reference="TTB-2026-0006",
        probes=(
            "The label disagrees with itself, so it is a defect before the "
            "application is consulted at all."
        ),
        application=ApplicationRecord(
            brand_name="Ferrier's Mark",
            class_type="Straight Rye Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Ferrier's Mark Distillery, 3 Anvil Ct, Nashville, TN",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.ALCOHOL_CONTENT: _why(
                    V.MISMATCH,
                    "The label states 45% alcohol by volume and 80 proof. Proof is "
                    "twice alcohol by volume by definition, so 45% is 90 proof and "
                    "the label contradicts itself. It happens to agree with the "
                    "application on the percentage, which is why this must be "
                    "caught on the label alone.",
                )
            },
        ),
        label_alcohol_content="45% Alc./Vol. (80 Proof)",
        palette=24,
    ),
    LabelSpec(
        id="net-contents-compound",
        application_reference="TTB-2026-0007",
        probes=(
            "A compound US declaration: two units naming one volume, which must "
            "be summed. Reading only the first part turned this into a 33% "
            "mismatch before the phase 2 review fixed it."
        ),
        application=ApplicationRecord(
            brand_name="Marlowe Cask",
            class_type="Blended Whiskey",
            alcohol_content="40% Alc./Vol. (80 Proof)",
            net_contents="709 mL",
            bottler_info="Bottled by Marlowe Cask Works, 18 Stave Rd, Peoria, IL",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.LOOKS_CORRECT,
            {
                F.NET_CONTENTS: _why(
                    V.MATCH,
                    "1 pint plus 8 fluid ounces is 709.76 mL, which is the same "
                    "declaration as 709 mL once rounding is allowed for.",
                )
            },
        ),
        label_net_contents="1 PINT 8 FL. OZ.",
        palette=25,
    ),
    LabelSpec(
        id="net-contents-restated",
        application_reference="TTB-2026-0008",
        probes=(
            "The opposite shape: one volume named twice. A parenthesized quantity "
            "restates, it never adds."
        ),
        application=ApplicationRecord(
            brand_name="Quarry Light",
            class_type="Vodka Distilled from Grain",
            alcohol_content="40% Alc./Vol. (80 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Quarry Light Spirits, 250 Granite Ave, Barre, VT",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.LOOKS_CORRECT,
            {
                F.NET_CONTENTS: _why(
                    V.MATCH,
                    "750 mL and 25.4 fl oz are the same volume written twice. "
                    "Summing them would invent a 1509 mL bottle.",
                )
            },
        ),
        label_net_contents="750 mL (25.4 fl oz)",
        palette=26,
    ),
    LabelSpec(
        id="net-contents-mismatch",
        application_reference="TTB-2026-0009",
        probes="A genuinely different fill, well outside the 0.5% rounding slack.",
        application=ApplicationRecord(
            brand_name="Selwyn Row",
            class_type="London Dry Gin",
            alcohol_content="42% Alc./Vol. (84 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Selwyn Row Distillers, 31 Botanic Ln, Charleston, SC",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.NET_CONTENTS: _why(
                    V.MISMATCH,
                    "750 mL claimed against 700 mL printed. That is a 6.7% "
                    "difference, far outside the rounding slack, so it is a "
                    "different declaration rather than a different way of writing "
                    "the same one.",
                )
            },
        ),
        label_net_contents="700 mL",
        palette=27,
    ),
    LabelSpec(
        id="address-saint-and-street",
        application_reference="TTB-2026-0010",
        probes=(
            "Both senses of St in one address. The first abbreviates Saint and "
            "the second abbreviates Street, and only position tells them apart."
        ),
        application=ApplicationRecord(
            brand_name="Coopers Bend",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Coopers Bend Distillery, 1 St James St, St. Louis, MO",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.LOOKS_CORRECT,
            {
                F.BOTTLER_INFO: _why(
                    V.MATCH,
                    "The label spells out what the application abbreviates. Both "
                    "sides resolve to the same address once St is read as Saint "
                    "before a name and Street at the end of a line.",
                )
            },
        ),
        label_bottler_info=(
            "BOTTLED BY COOPERS BEND DISTILLERY, 1 SAINT JAMES STREET, SAINT LOUIS, MO"
        ),
        palette=28,
    ),
    LabelSpec(
        id="address-directional",
        application_reference="TTB-2026-0011",
        probes=(
            "A directional abbreviation on a street line carrying no house "
            "number. assumptions.md section 8 records this as a known limit of "
            "the positional rule."
        ),
        application=ApplicationRecord(
            brand_name="Fox Hollow",
            class_type="Pinot Noir",
            alcohol_content="13.5% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Fox Hollow Cellars, North Main St, Napa, CA",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.BOTTLER_INFO: _why(
                    V.NEEDS_REVIEW,
                    "The ideal verdict is match: N Main St and North Main St are "
                    "the same street. The engine cannot reach it, because a "
                    "directional only expands inside a segment that starts with a "
                    "house number and this one does not. Landing on needs review "
                    "is the safe direction to fail, and it is the outcome this "
                    "fixture pins until the rule improves.",
                )
            },
        ),
        label_bottler_info="PRODUCED AND BOTTLED BY FOX HOLLOW CELLARS, N MAIN ST, NAPA, CA",
        palette=29,
    ),
    LabelSpec(
        id="import-missing-country",
        application_reference="TTB-2026-0012",
        probes="A conditional field: required because the application declares an import.",
        application=ApplicationRecord(
            brand_name="Ardmore Quay",
            class_type="Irish Whiskey",
            alcohol_content="40% Alc./Vol. (80 Proof)",
            net_contents="750 mL",
            bottler_info="Imported by Ardmore Quay Selections, 90 Harbor St, Portland, ME",
            country_of_origin="Ireland",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=True,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.COUNTRY_OF_ORIGIN: _why(
                    V.MISMATCH,
                    "The application declares an import, so the label must state a "
                    "country of origin, and it states none.",
                )
            },
            is_import=True,
        ),
        label_country_of_origin=None,
        palette=30,
    ),
    LabelSpec(
        id="warning-missing",
        application_reference="TTB-2026-0013",
        probes="No health warning at all. The most fundamental failure of 27 CFR 16.21.",
        application=ApplicationRecord(
            brand_name="Pellham Grove",
            class_type="Merlot",
            alcohol_content="13% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Pellham Grove Winery, 12 Trellis Rd, Napa, CA",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.MISMATCH,
                    "The statement required by 27 CFR 16.21 does not appear.",
                )
            },
        ),
        warning=NO_WARNING,
        palette=31,
    ),
    LabelSpec(
        id="warning-title-case",
        application_reference="TTB-2026-0014",
        probes=(
            "Correct wording, wrong capitalization. This must report as one "
            "capitalization failure, not as a dozen wording changes."
        ),
        application=ApplicationRecord(
            brand_name="Tallow Creek",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Tallow Creek Distillery, 6 Char House Rd, Owensboro, KY",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.MISMATCH,
                    "The words GOVERNMENT WARNING: must be in capitals "
                    "(27 CFR 16.22(a)). The wording itself is correct, which is why "
                    "wording is compared case-insensitively and capitalization is "
                    "judged separately straight afterwards.",
                )
            },
        ),
        warning=WarningSpec(text=TITLE_CASE_WARNING, prefix_is_caps=False),
        palette=32,
    ),
    LabelSpec(
        id="warning-altered-wording",
        application_reference="TTB-2026-0015",
        probes="One verb changed. Exercises the word-level diff the review view renders.",
        application=ApplicationRecord(
            brand_name="Weathervane",
            class_type="American Single Malt Whiskey",
            alcohol_content="46% Alc./Vol. (92 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Weathervane Distilling, 21 Kiln St, Portland, ME",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.MISMATCH,
                    "The statute says may cause health problems and the label says "
                    "can. The text is fixed by 27 CFR 16.21, so any wording "
                    "difference is a real violation however small it reads.",
                )
            },
        ),
        warning=WarningSpec(text=ALTERED_WARNING),
        palette=33,
    ),
    LabelSpec(
        id="warning-not-bold",
        application_reference="TTB-2026-0016",
        probes=(
            "Bold graded softly per ADR-005. Font weight cannot be judged "
            "reliably from a photograph, so this is a review and not a failure."
        ),
        application=ApplicationRecord(
            brand_name="Hearthstone Row",
            class_type="Amber Ale",
            alcohol_content="5.6% Alc./Vol.",
            net_contents="355 mL",
            bottler_info="Brewed and bottled by Hearthstone Row Brewing, 8 Malt Ln, Madison, WI",
            beverage_class=BeverageClass.MALT_BEVERAGE,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.NEEDS_REVIEW,
                    "The opening words must be bold (27 CFR 16.22(a)) and they do "
                    "not appear to be. A false hard failure on a compliant label "
                    "costs more trust than it saves, so this asks the agent to "
                    "check the physical label.",
                )
            },
        ),
        warning=WarningSpec(prefix_is_bold=False),
        palette=34,
    ),
    LabelSpec(
        id="warning-remainder-bold",
        application_reference="TTB-2026-0017",
        probes=(
            "The other half of the bold rule. The remainder must not be bold, "
            "which is why the contract carries two weight flags and not one."
        ),
        application=ApplicationRecord(
            brand_name="Windlass Bay",
            class_type="Dry Cider Style Malt Beverage",
            alcohol_content="6% Alc./Vol.",
            net_contents="500 mL",
            bottler_info="Brewed and bottled by Windlass Bay Beverage Co, 2 Quay St, Newport, RI",
            beverage_class=BeverageClass.MALT_BEVERAGE,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.NEEDS_REVIEW,
                    "The whole block is bold. Only the opening words may be "
                    "(27 CFR 16.22(a)). Graded softly for the same reason as the "
                    "prefix weight.",
                )
            },
        ),
        warning=WarningSpec(remainder_is_bold=True),
        palette=35,
    ),
    LabelSpec(
        id="warning-undersized",
        application_reference="TTB-2026-0018",
        probes=(
            "Type size is keyed to the container, not the label. 1mm is fully "
            "compliant on the 50 mL miniature in this same corpus."
        ),
        application=ApplicationRecord(
            brand_name="Kestrel Fields",
            class_type="Chardonnay",
            alcohol_content="13% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Kestrel Fields Winery, 40 Vine Rd, Walla Walla, WA",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_expect(
            S.NEEDS_REVIEW,
            {
                F.GOVERNMENT_WARNING: _why(
                    V.NEEDS_REVIEW,
                    "Rendered at 1mm on a 750 mL bottle, which requires 2mm "
                    "(27 CFR 16.22(b)). A millimetre estimated from a photograph is "
                    "not evidence enough to fail a label, so the agent is asked to "
                    "measure.",
                )
            },
        ),
        warning=WarningSpec(type_size_mm=1.0),
        palette=36,
    ),
    LabelSpec(
        id="brand-name-mismatch",
        application_reference="TTB-2026-0019",
        probes=(
            "A brand extension is a different product, not a transcription slip. "
            "Only the brand differs, so the fuzzy threshold is what is on trial."
        ),
        application=ApplicationRecord(
            brand_name="Kingfisher Bay",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Kingfisher Bay Distillery, 9 Estuary Rd, Mobile, AL",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.BRAND_NAME: _why(
                    V.MISMATCH,
                    "The application covers Kingfisher Bay and the label reads "
                    "Kingfisher Bay Reserve Cask. That is a different product "
                    "designation, not a different spelling of the same one, so it "
                    "falls through the fuzzy tier rather than resting in it.",
                )
            },
        ),
        label_brand_name="Kingfisher Bay Reserve Cask",
        palette=40,
    ),
    LabelSpec(
        id="class-type-mismatch",
        application_reference="TTB-2026-0020",
        probes=(
            "A misdeclared class. Blended whiskey approved as straight bourbon is "
            "a substantive labeling violation, not a wording preference."
        ),
        application=ApplicationRecord(
            brand_name="Millrace Reserve",
            class_type="Kentucky Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Millrace Distilling Co, 27 Weir St, Lexington, KY",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.CLASS_TYPE: _why(
                    V.MISMATCH,
                    "Straight bourbon claimed, blended whiskey printed. The synonym "
                    "table folds whisky and whiskey precisely so that it does not "
                    "fold designations that name genuinely different products.",
                )
            },
        ),
        label_class_type="Blended Whiskey",
        palette=41,
    ),
    LabelSpec(
        id="bottler-address-mismatch",
        application_reference="TTB-2026-0021",
        probes=(
            "The 0.70 address threshold is deliberately wide. This checks it is "
            "not so wide that an entirely different bottler scores through it."
        ),
        application=ApplicationRecord(
            brand_name="Yarrow Flats",
            class_type="Straight Rye Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Yarrow Flats Distillery, 9 Estuary Rd, Mobile, AL",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_expect(
            S.PROBLEM_FOUND,
            {
                F.BOTTLER_INFO: _why(
                    V.MISMATCH,
                    "A different company at a different address in a different "
                    "state. Nothing about this is a formatting variation.",
                )
            },
        ),
        label_bottler_info="BOTTLED BY GRANITE FALLS BEVERAGE, 4100 INDUSTRIAL PKWY, TOPEKA, KS",
        palette=42,
    ),
    LabelSpec(
        id="unreadable-glare",
        application_reference="TTB-2026-0022",
        probes="Specular glare across the label face. No field verdicts at all.",
        application=ApplicationRecord(
            brand_name="Saltmarsh Lane",
            class_type="Straight Bourbon Whiskey",
            alcohol_content="45% Alc./Vol. (90 Proof)",
            net_contents="750 mL",
            bottler_info="Bottled by Saltmarsh Lane Distillery, 15 Tide Rd, Savannah, GA",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=False,
        ),
        expected=_unreadable(UnreadableReason.GLARE),
        degradation=Degradation.GLARE,
        palette=37,
    ),
    LabelSpec(
        id="unreadable-blur",
        application_reference="TTB-2026-0023",
        probes="Out of focus. The correct answer is to ask for a better photo.",
        application=ApplicationRecord(
            brand_name="Perch Point",
            class_type="Riesling",
            alcohol_content="11.5% Alc./Vol.",
            net_contents="750 mL",
            bottler_info="Produced and bottled by Perch Point Cellars, 3 Lake Rd, Geneva, NY",
            beverage_class=BeverageClass.WINE,
            is_import=False,
        ),
        expected=_unreadable(UnreadableReason.BLUR),
        degradation=Degradation.BLUR,
        palette=38,
    ),
    LabelSpec(
        id="unreadable-angle",
        application_reference="TTB-2026-0024",
        probes="Photographed at a severe oblique angle.",
        application=ApplicationRecord(
            brand_name="Drover's Rest",
            class_type="Scotch Whiskey",
            alcohol_content="43% Alc./Vol. (86 Proof)",
            net_contents="700 mL",
            bottler_info="Imported by Drover's Rest Selections, 4 Kirk St, Chicago, IL",
            country_of_origin="Scotland",
            beverage_class=BeverageClass.DISTILLED_SPIRITS,
            is_import=True,
        ),
        expected=_unreadable(UnreadableReason.ANGLE),
        degradation=Degradation.ANGLE,
        palette=39,
    ),
)


# --------------------------------------------------------------------------
# The clean majority
#
# A queue where half the items are violations misrepresents the job
# (approach.md section 5.8), so these outnumber the defect cases. They also walk
# the parameter space deliberately: all three beverage classes, all three
# type-size bands from 27 CFR 16.22(b), and imports alongside domestic products.
# beverage_class is set explicitly on every record, which closes the gap in
# assumptions.md section 8 where an omitted class silently took the 0.3 band.
# --------------------------------------------------------------------------

CLEAN_SPECS: tuple[LabelSpec, ...] = (
    _clean(
        "clean-bourbon-750",
        "TTB-2026-0101",
        "Copper Kettle",
        "Kentucky Straight Bourbon Whiskey",
        "45% Alc./Vol. (90 Proof)",
        "750 mL",
        "Bottled by Copper Kettle Distillery, 480 Rickhouse Rd, Bardstown, KY",
        BeverageClass.DISTILLED_SPIRITS,
        palette=0,
    ),
    _clean(
        "clean-rye-750",
        "TTB-2026-0102",
        "Harrow Lane",
        "Straight Rye Whiskey",
        "47.5% Alc./Vol. (95 Proof)",
        "750 mL",
        "Distilled and bottled by Harrow Lane Spirits, 12 Mill Race Ave, Frankfort, KY",
        BeverageClass.DISTILLED_SPIRITS,
        degradation=Degradation.PHOTO,
        palette=1,
    ),
    _clean(
        "clean-vodka-1750",
        "TTB-2026-0103",
        "Tidewater",
        "Vodka Distilled from Grain",
        "40% Alc./Vol. (80 Proof)",
        "1.75 L",
        "Bottled by Tidewater Distilling Co, 900 Harbor Blvd, Norfolk, VA",
        BeverageClass.DISTILLED_SPIRITS,
        probes="A 1.75 L bottle, the top of the 2mm type-size band.",
        palette=2,
    ),
    _clean(
        "clean-gin-750",
        "TTB-2026-0104",
        "Fernhollow",
        "London Dry Gin",
        "44% Alc./Vol. (88 Proof)",
        "750 mL",
        "Bottled by Fernhollow Botanical Works, 7 Juniper Ct, Ste 2, Portland, OR",
        BeverageClass.DISTILLED_SPIRITS,
        probes="A suite number in the address, expanded by the unit-form table.",
        degradation=Degradation.PHOTO,
        palette=3,
    ),
    _clean(
        "clean-scotch-import",
        "TTB-2026-0105",
        "Glen Marrow",
        "Single Malt Scotch Whiskey",
        "43% Alc./Vol. (86 Proof)",
        "700 mL",
        "Imported by Northgate Selections Inc, 55 Dock St, Boston, MA",
        BeverageClass.DISTILLED_SPIRITS,
        country="Scotland",
        label_class_type="Single Malt Scotch Whisky",
        probes="The whisky and whiskey spelling fold. Scots producers drop the e.",
        palette=4,
    ),
    _clean(
        "clean-bourbon-50",
        "TTB-2026-0106",
        "Copper Kettle",
        "Kentucky Straight Bourbon Whiskey",
        "45% Alc./Vol. (90 Proof)",
        "50 mL",
        "Bottled by Copper Kettle Distillery, 480 Rickhouse Rd, Bardstown, KY",
        BeverageClass.DISTILLED_SPIRITS,
        type_size_mm=1.2,
        probes="A 50 mL miniature. 1.2mm type is legal here and fails on a 750.",
        palette=5,
    ),
    _clean(
        "clean-tequila-import",
        "TTB-2026-0107",
        "Casa Verano",
        "Tequila Blanco",
        "40% Alc./Vol. (80 Proof)",
        "750 mL",
        "Imported by Verano Bros, 210 Alameda St, San Diego, CA",
        BeverageClass.DISTILLED_SPIRITS,
        country="Mexico",
        probes="The entity-form table: Bros expands to Brothers.",
        palette=6,
    ),
    _clean(
        "clean-rum-import",
        "TTB-2026-0108",
        "Palmetto Cay",
        "Aged Caribbean Rum",
        "40% Alc./Vol. (80 Proof)",
        "750 mL",
        "Imported by Palmetto Cay Trading Ltd, 44 Wharf Ln, Miami, FL",
        BeverageClass.DISTILLED_SPIRITS,
        country="Barbados",
        degradation=Degradation.PHOTO,
        palette=7,
    ),
    _clean(
        "clean-brandy-750",
        "TTB-2026-0109",
        "Orchard Row",
        "Grape Brandy",
        "40% Alc./Vol. (80 Proof)",
        "750 mL",
        "Produced and bottled by Orchard Row Cellars, 88 Vineyard Dr, Modesto, CA",
        BeverageClass.DISTILLED_SPIRITS,
        palette=8,
    ),
    _clean(
        "clean-liqueur-375",
        "TTB-2026-0110",
        "Juniper Hollow",
        "Coffee Liqueur",
        "20% Alc./Vol. (40 Proof)",
        "375 mL",
        "Bottled by Juniper Hollow Corp, 3 Founders Sq, Asheville, NC",
        BeverageClass.DISTILLED_SPIRITS,
        palette=9,
    ),
    _clean(
        "clean-wine-chardonnay",
        "TTB-2026-0111",
        "Larkspur Bench",
        "Napa Valley Chardonnay",
        "13.5% Alc./Vol.",
        "750 mL",
        "Produced and bottled by Larkspur Bench Winery, 1400 Silverado Trail, Napa, CA",
        BeverageClass.WINE,
        palette=10,
    ),
    _clean(
        "clean-wine-cabernet",
        "TTB-2026-0112",
        "Stonebridge Ridge",
        "Cabernet Sauvignon",
        "14.5% Alc./Vol.",
        "750 mL",
        "Produced and bottled by Stonebridge Ridge Vineyards, 22 Crest Rd, Paso Robles, CA",
        BeverageClass.WINE,
        probes="Above the 14% wine tax-class boundary, on a clean match.",
        degradation=Degradation.PHOTO,
        palette=11,
    ),
    _clean(
        "clean-wine-import-france",
        "TTB-2026-0113",
        "Domaine Clairval",
        "Cotes du Rhone Red Wine",
        "13% Alc./Vol.",
        "750 mL",
        "Imported by Meridian Wine Company, 615 Canal St, New Orleans, LA",
        BeverageClass.WINE,
        country="France",
        palette=12,
    ),
    _clean(
        "clean-wine-box-5l",
        "TTB-2026-0114",
        "Prairie Gate",
        "California Red Blend",
        "12.5% Alc./Vol.",
        "5 L",
        "Produced and bottled by Prairie Gate Cellars, 305 Orchard Ln, Lodi, CA",
        BeverageClass.WINE,
        type_size_mm=3.2,
        probes="Over 3 L, so 27 CFR 16.22(b) demands 3mm type rather than 2mm.",
        palette=13,
    ),
    _clean(
        "clean-wine-rose-375",
        "TTB-2026-0115",
        "Willow Fen",
        "Dry Rose Wine",
        "12% Alc./Vol.",
        "375 mL",
        "Produced and bottled by Willow Fen Estate, 9 Marsh Rd, Healdsburg, CA",
        BeverageClass.WINE,
        palette=14,
    ),
    _clean(
        "clean-sake-import",
        "TTB-2026-0116",
        "Kurogane",
        "Junmai Sake",
        "15.5% Alc./Vol.",
        "720 mL",
        "Imported by Kurogane Trading Inc, 1200 Bayfront Ave, Seattle, WA",
        BeverageClass.WINE,
        country="Japan",
        probes="Taxed as wine and above 14%, so the tighter 1.0 point band applies.",
        palette=15,
    ),
    _clean(
        "clean-malt-ipa",
        "TTB-2026-0117",
        "Anvil Point",
        "India Pale Ale",
        "6.8% Alc./Vol.",
        "355 mL",
        "Brewed and bottled by Anvil Point Brewing Co, 77 Forge St, Bend, OR",
        BeverageClass.MALT_BEVERAGE,
        degradation=Degradation.PHOTO,
        palette=16,
    ),
    _clean(
        "clean-malt-pilsner",
        "TTB-2026-0118",
        "Marsh Harbor",
        "Pilsner Style Lager",
        "4.8% Alc./Vol.",
        "12 fl oz",
        "Brewed and bottled by Marsh Harbor Brewery, 5 Pier Rd, Annapolis, MD",
        BeverageClass.MALT_BEVERAGE,
        probes="Net contents declared in US customary units on both sides.",
        palette=17,
    ),
    _clean(
        "clean-malt-stout",
        "TTB-2026-0119",
        "Blackthorn Mill",
        "Oatmeal Stout",
        "7.2% Alc./Vol.",
        "650 mL",
        "Brewed and bottled by Blackthorn Mill Brewing, 41 Grist Ave, Burlington, VT",
        BeverageClass.MALT_BEVERAGE,
        palette=18,
    ),
    _clean(
        "clean-malt-import",
        "TTB-2026-0120",
        "Sol Cantera",
        "Cerveza Clara",
        "4.5% Alc./Vol.",
        "355 mL",
        "Imported by Cantera Beverage Company, 800 Rio Grande Blvd, El Paso, TX",
        BeverageClass.MALT_BEVERAGE,
        country="Mexico",
        degradation=Degradation.PHOTO,
        palette=19,
    ),
)


SPECS: tuple[LabelSpec, ...] = DEFECT_SPECS + CLEAN_SPECS
