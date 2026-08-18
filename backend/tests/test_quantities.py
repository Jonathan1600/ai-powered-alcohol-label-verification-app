"""Numeric parsing and the 27 CFR tolerance bands."""

import pytest

from app.matching.contracts import BeverageClass
from app.matching.quantities import (
    AlcoholContent,
    Comparison,
    abv_tolerance,
    compare_alcohol_content,
    compare_volume,
    parse_alcohol_content,
    parse_volume,
)


class TestParseAlcoholContent:
    def test_percent_with_proof_in_parentheses(self):
        parsed = parse_alcohol_content("45% Alc./Vol. (90 Proof)")
        assert parsed.abv == 45.0
        assert parsed.proof == 90.0

    @pytest.mark.parametrize(
        "text",
        [
            "12.5% alcohol by volume",
            "ALC. 12.5% BY VOL.",
            "Alcohol 12.5 percent by volume",
            "12.5% ALC/VOL",
        ],
    )
    def test_common_label_formats(self, text):
        assert parse_alcohol_content(text).abv == 12.5

    def test_bare_proof_derives_abv(self):
        parsed = parse_alcohol_content("90 Proof")
        assert parsed.abv == 45.0
        assert parsed.proof == 90.0

    def test_bare_proof_is_not_read_as_a_percentage(self):
        """`90 Proof` must never parse as 90% alcohol by volume."""
        assert parse_alcohol_content("90 Proof").abv == 45.0

    def test_unparseable_returns_none(self):
        assert parse_alcohol_content("strong") is None
        assert parse_alcohol_content(None) is None


class TestProofConsistency:
    def test_proof_twice_abv_is_consistent(self):
        assert AlcoholContent(abv=45.0, proof=90.0).proof_is_consistent

    def test_proof_disagreeing_with_abv_is_not(self):
        assert not AlcoholContent(abv=45.0, proof=80.0).proof_is_consistent

    def test_absent_proof_cannot_be_inconsistent(self):
        assert AlcoholContent(abv=45.0, proof=None).proof_is_consistent

    def test_rounding_of_a_tenth_is_tolerated(self):
        assert AlcoholContent(abv=40.05, proof=80.0).proof_is_consistent


class TestParseVolume:
    def test_millilitres_and_litres_are_the_same_volume(self):
        assert parse_volume("750 mL").milliliters == parse_volume("0.75 L").milliliters

    @pytest.mark.parametrize(
        ("text", "expected_ml"),
        [
            ("750 mL", 750.0),
            ("1.75 Liters", 1750.0),
            ("50 mL", 50.0),
            ("3 L", 3000.0),
        ],
    )
    def test_units_convert(self, text, expected_ml):
        assert parse_volume(text).milliliters == pytest.approx(expected_ml)

    def test_fluid_ounces_convert(self):
        assert parse_volume("12 FL OZ").milliliters == pytest.approx(354.88, abs=0.01)

    def test_a_compound_declaration_is_summed(self):
        """US labels write 709 mL as `1 PINT 8 FL. OZ.`, which is one volume."""
        assert parse_volume("1 PINT 8 FL. OZ.").milliliters == pytest.approx(709.76, abs=0.01)

    def test_a_parenthetical_restatement_is_not_added(self):
        """`750 mL (25.4 fl oz)` is one volume said twice, not 1.5 litres."""
        assert parse_volume("750 mL (25.4 fl oz)").milliliters == pytest.approx(750.0)
        assert parse_volume("12 fl oz (355 mL)").milliliters == pytest.approx(354.88, abs=0.01)

    def test_an_unparenthesized_restatement_is_not_added(self):
        """Parts of a compound descend in size; a restatement does not."""
        assert parse_volume("750 mL 25.4 fl oz").milliliters == pytest.approx(750.0)

    def test_a_lone_parenthesized_quantity_still_parses(self):
        assert parse_volume("Net contents (750 mL)").milliliters == pytest.approx(750.0)

    def test_unparseable_returns_none(self):
        assert parse_volume("one bottle") is None
        assert parse_volume(None) is None


class TestAbvTolerance:
    def test_wine_at_or_below_fourteen_gets_the_wider_band(self):
        """27 CFR 4.36(b)(1)."""
        assert abv_tolerance(BeverageClass.WINE, 12.0) == 1.5
        assert abv_tolerance(BeverageClass.WINE, 14.0) == 1.5

    def test_wine_above_fourteen_gets_the_narrower_band(self):
        assert abv_tolerance(BeverageClass.WINE, 15.0) == 1.0

    def test_spirits_band(self):
        """27 CFR 5.65(a)(2)."""
        assert abv_tolerance(BeverageClass.DISTILLED_SPIRITS, 45.0) == 0.3

    def test_malt_band(self):
        """27 CFR 7.65(b)(2)."""
        assert abv_tolerance(BeverageClass.MALT_BEVERAGE, 5.0) == 0.3

    def test_malt_below_half_a_percent_gets_no_tolerance(self):
        assert abv_tolerance(BeverageClass.MALT_BEVERAGE, 0.4) == 0.0


class TestCompareAlcoholContent:
    def test_identical_values_are_equal(self):
        outcome, difference = compare_alcohol_content(
            AlcoholContent(45.0), AlcoholContent(45.0), BeverageClass.DISTILLED_SPIRITS
        )
        assert outcome is Comparison.EQUAL
        assert difference == 0.0

    def test_spirits_just_inside_the_band(self):
        outcome, _ = compare_alcohol_content(
            AlcoholContent(45.0), AlcoholContent(45.3), BeverageClass.DISTILLED_SPIRITS
        )
        assert outcome is Comparison.WITHIN_TOLERANCE

    def test_spirits_just_outside_the_band(self):
        outcome, difference = compare_alcohol_content(
            AlcoholContent(45.0), AlcoholContent(45.4), BeverageClass.DISTILLED_SPIRITS
        )
        assert outcome is Comparison.OUT_OF_TOLERANCE
        assert difference == pytest.approx(0.4)

    def test_wine_within_the_wide_band(self):
        outcome, _ = compare_alcohol_content(
            AlcoholContent(12.0), AlcoholContent(13.5), BeverageClass.WINE
        )
        assert outcome is Comparison.WITHIN_TOLERANCE

    def test_wine_tolerance_cannot_bridge_the_tax_class_boundary(self):
        """27 CFR 4.36(b)(2). 13.9 to 14.1 is a small gap but crosses grades."""
        outcome, _ = compare_alcohol_content(
            AlcoholContent(13.9), AlcoholContent(14.1), BeverageClass.WINE
        )
        assert outcome is Comparison.CROSSES_TAX_CLASS

    def test_missing_side_is_unparseable(self):
        outcome, _ = compare_alcohol_content(
            None, AlcoholContent(45.0), BeverageClass.DISTILLED_SPIRITS
        )
        assert outcome is Comparison.UNPARSEABLE


class TestCompareVolume:
    def test_same_volume_in_different_units_is_equal(self):
        assert compare_volume(parse_volume("750 mL"), parse_volume("0.75 L")) is Comparison.EQUAL

    def test_rounding_between_unit_systems_is_absorbed(self):
        # 750 mL is 25.36 fl oz; a label rounding to 25.4 is the same declaration.
        assert (
            compare_volume(parse_volume("750 mL"), parse_volume("25.4 fl oz")) is Comparison.EQUAL
        )

    def test_genuinely_different_volumes_are_out_of_tolerance(self):
        assert (
            compare_volume(parse_volume("750 mL"), parse_volume("375 mL"))
            is Comparison.OUT_OF_TOLERANCE
        )
