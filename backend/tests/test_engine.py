"""End to end through the engine: field dispatch, status rollup, unreadable path."""

from app.matching import verify
from app.matching.contracts import (
    BeverageClass,
    ExtractedField,
    FieldName,
    OverallStatus,
    Readability,
    UnreadableReason,
    Verdict,
)
from tests.conftest import compliant_warning, field


def result_for(result, name: FieldName):
    return next(item for item in result.fields if item.field is name)


class TestCleanPass:
    def test_matching_application_and_label_looks_correct(self, application, extraction):
        result = verify(application, extraction)
        assert result.status is OverallStatus.LOOKS_CORRECT
        assert all(item.verdict is Verdict.MATCH for item in result.fields)

    def test_stones_throw_case_variance_still_passes(self, application, extraction):
        """The case named in the build plan: caps plus a curly apostrophe."""
        extraction.brand_name = field("STONE’S THROW")
        result = verify(application, extraction)
        assert result_for(result, FieldName.BRAND_NAME).verdict is Verdict.MATCH
        assert result.status is OverallStatus.LOOKS_CORRECT

    def test_net_contents_in_different_units_passes(self, application, extraction):
        extraction.net_contents = field("0.75 L")
        assert result_for(verify(application, extraction), FieldName.NET_CONTENTS).verdict is (
            Verdict.MATCH
        )


class TestBrandName:
    def test_close_brand_name_needs_review(self, application, extraction):
        extraction.brand_name = field("Stone's Throwe")
        result = verify(application, extraction)
        assert result_for(result, FieldName.BRAND_NAME).verdict is Verdict.NEEDS_REVIEW
        assert result.status is OverallStatus.NEEDS_REVIEW

    def test_different_brand_name_is_a_mismatch(self, application, extraction):
        extraction.brand_name = field("Riverbend Reserve")
        result = verify(application, extraction)
        assert result_for(result, FieldName.BRAND_NAME).verdict is Verdict.MISMATCH
        assert result.status is OverallStatus.PROBLEM_FOUND

    def test_brand_name_absent_from_the_label_is_a_mismatch(self, application, extraction):
        extraction.brand_name = field(None)
        assert result_for(verify(application, extraction), FieldName.BRAND_NAME).verdict is (
            Verdict.MISMATCH
        )


class TestClassType:
    def test_whisky_spelling_variant_passes(self, application, extraction):
        application.class_type = "Kentucky Straight Bourbon Whisky"
        assert result_for(verify(application, extraction), FieldName.CLASS_TYPE).verdict is (
            Verdict.MATCH
        )

    def test_word_order_difference_passes(self, application, extraction):
        extraction.class_type = field("Straight Bourbon Whiskey, Kentucky")
        assert result_for(verify(application, extraction), FieldName.CLASS_TYPE).verdict is (
            Verdict.MATCH
        )


class TestAlcoholContent:
    def test_abv_mismatch_beyond_tolerance_is_a_problem(self, application, extraction):
        extraction.alcohol_content = field("40% Alc./Vol. (80 Proof)")
        result = verify(application, extraction)
        assert result_for(result, FieldName.ALCOHOL_CONTENT).verdict is Verdict.MISMATCH
        assert result.status is OverallStatus.PROBLEM_FOUND

    def test_abv_within_tolerance_needs_review(self, application, extraction):
        extraction.alcohol_content = field("45.2% Alc./Vol.")
        item = result_for(verify(application, extraction), FieldName.ALCOHOL_CONTENT)
        assert item.verdict is Verdict.NEEDS_REVIEW
        assert "0.3 point tolerance" in item.reason

    def test_proof_disagreeing_with_abv_is_a_label_defect(self, application, extraction):
        """The label contradicts itself, regardless of the application."""
        extraction.alcohol_content = field("45% Alc./Vol. (80 Proof)")
        item = result_for(verify(application, extraction), FieldName.ALCOHOL_CONTENT)
        assert item.verdict is Verdict.MISMATCH
        assert "contradicts itself" in item.reason

    def test_wine_boundary_crossing_is_a_mismatch(self, application, extraction):
        application.beverage_class = BeverageClass.WINE
        application.alcohol_content = "13.9% alcohol by volume"
        extraction.alcohol_content = field("14.1% alcohol by volume")
        item = result_for(verify(application, extraction), FieldName.ALCOHOL_CONTENT)
        assert item.verdict is Verdict.MISMATCH
        assert "tax classes" in item.reason

    def test_unparseable_alcohol_statement_needs_review(self, application, extraction):
        extraction.alcohol_content = field("full strength")
        assert result_for(verify(application, extraction), FieldName.ALCOHOL_CONTENT).verdict is (
            Verdict.NEEDS_REVIEW
        )


class TestNetContents:
    def test_different_volume_is_a_mismatch(self, application, extraction):
        extraction.net_contents = field("375 mL")
        assert result_for(verify(application, extraction), FieldName.NET_CONTENTS).verdict is (
            Verdict.MISMATCH
        )


class TestBottlerInfo:
    def test_address_abbreviation_difference_passes(self, application, extraction):
        extraction.bottler_info = field(
            "Bottled by Stone's Throw Distillery, 120 Main Street, Bardstown, KY"
        )
        assert result_for(verify(application, extraction), FieldName.BOTTLER_INFO).verdict is (
            Verdict.MATCH
        )

    def test_a_different_address_biases_toward_review(self, application, extraction):
        """Addresses vary harmlessly, so this tier is wide by design."""
        extraction.bottler_info = field(
            "Bottled by Stone's Throw Distillery, 128 Main St, Bardstown, KY"
        )
        assert result_for(verify(application, extraction), FieldName.BOTTLER_INFO).verdict is (
            Verdict.NEEDS_REVIEW
        )


class TestCountryOfOrigin:
    def test_domestic_product_omits_the_field_entirely(self, application, extraction):
        application.is_import = False
        result = verify(application, extraction)
        assert all(item.field is not FieldName.COUNTRY_OF_ORIGIN for item in result.fields)

    def test_import_missing_country_of_origin_is_a_mismatch(self, application, extraction):
        application.is_import = True
        application.country_of_origin = "Product of Scotland"
        extraction.country_of_origin = field(None)
        result = verify(application, extraction)
        item = result_for(result, FieldName.COUNTRY_OF_ORIGIN)
        assert item.verdict is Verdict.MISMATCH
        assert result.status is OverallStatus.PROBLEM_FOUND

    def test_import_with_matching_country_passes(self, application, extraction):
        application.is_import = True
        application.country_of_origin = "Product of Scotland"
        extraction.country_of_origin = field("PRODUCT OF SCOTLAND")
        assert result_for(
            verify(application, extraction), FieldName.COUNTRY_OF_ORIGIN
        ).verdict is Verdict.MATCH


class TestGovernmentWarningThroughTheEngine:
    def test_missing_warning_surfaces_as_a_problem(self, application, extraction):
        extraction.government_warning = compliant_warning(present=False, verbatim=None)
        result = verify(application, extraction)
        assert result_for(result, FieldName.GOVERNMENT_WARNING).verdict is Verdict.MISMATCH
        assert result.status is OverallStatus.PROBLEM_FOUND

    def test_type_size_threshold_follows_the_label_container(self, application, extraction):
        """A 50 mL bottle legitimately carries 1mm type."""
        application.net_contents = "50 mL"
        extraction.net_contents = field("50 mL")
        extraction.government_warning = compliant_warning(estimated_type_size_mm=1.0)
        assert result_for(
            verify(application, extraction), FieldName.GOVERNMENT_WARNING
        ).verdict is Verdict.MATCH


class TestConfidenceGating:
    def test_low_confidence_downgrades_a_match(self, application, extraction):
        extraction.brand_name = ExtractedField(verbatim="Stone's Throw", confidence=0.4)
        item = result_for(verify(application, extraction), FieldName.BRAND_NAME)
        assert item.verdict is Verdict.NEEDS_REVIEW
        assert "low confidence" in item.reason

    def test_low_confidence_never_rescues_a_mismatch(self, application, extraction):
        extraction.brand_name = ExtractedField(verbatim="Riverbend Reserve", confidence=0.1)
        assert result_for(verify(application, extraction), FieldName.BRAND_NAME).verdict is (
            Verdict.MISMATCH
        )


class TestUnreadable:
    def test_unreadable_short_circuits_before_any_matching(self, application, extraction):
        extraction.readability = Readability(unreadable=True, reason=UnreadableReason.GLARE)
        result = verify(application, extraction)
        assert result.status is OverallStatus.UNREADABLE
        assert result.unreadable_reason is UnreadableReason.GLARE
        assert result.fields == []

    def test_unreadable_wins_even_when_fields_were_extracted(self, application, extraction):
        """A guess from an unreadable photo must never be dressed up as evidence."""
        extraction.readability = Readability(unreadable=True, reason=UnreadableReason.BLUR)
        extraction.brand_name = field("Riverbend Reserve")
        assert verify(application, extraction).fields == []


class TestStatusRollup:
    def test_worst_verdict_wins(self, application, extraction):
        extraction.brand_name = field("Stone's Throwe")  # needs review
        extraction.net_contents = field("375 mL")  # mismatch
        assert verify(application, extraction).status is OverallStatus.PROBLEM_FOUND
