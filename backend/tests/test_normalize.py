"""Normalization folds away differences that are not real disagreements."""

from app.matching.normalize import (
    collapse_whitespace,
    normalize,
    normalize_address,
    normalize_class_type,
    strip_punctuation,
    token_sort,
)


def test_stones_throw_case_and_curly_apostrophe():
    """The case named in approach.md section 5.3. Caps plus a curly apostrophe."""
    assert normalize("STONE’S THROW") == normalize("Stone's Throw")


def test_straight_and_curly_apostrophes_agree():
    assert normalize("Stone’s") == normalize("Stone's")


def test_smart_quotes_fold_to_straight():
    assert normalize("“Reserve”") == normalize('"Reserve"')


def test_dash_variants_fold_together():
    assert normalize("Small—Batch") == normalize("Small-Batch")


def test_whitespace_collapses_across_line_breaks():
    assert normalize("Stone's\n\n  Throw") == "stone's throw"


def test_nfkc_folds_compatibility_forms():
    # Fullwidth characters and a non-breaking space both normalize under NFKC.
    assert normalize("Ｓtone's Throw") == "stone's throw"


def test_collapse_whitespace_preserves_case():
    """The warning path needs spacing normalized but capitalization intact."""
    assert collapse_whitespace("GOVERNMENT   WARNING:\n  (1) According") == (
        "GOVERNMENT WARNING: (1) According"
    )


def test_strip_punctuation_leaves_words():
    assert strip_punctuation("stone's throw, ltd.") == "stone s throw ltd"


def test_address_abbreviations_expand():
    assert normalize_address("120 Main St") == normalize_address("120 Main Street")


def test_address_expansion_only_matches_whole_tokens():
    """`St` inside a word must survive, or `Sterling` becomes nonsense."""
    assert "street" not in normalize_address("Sterling Vineyards")


def test_an_abbreviation_with_a_period_expands_to_the_same_word():
    """The period must not survive the expansion, or the exact tier never fires."""
    assert normalize_address("120 Main St.") == normalize_address("120 Main Street")


def test_saint_is_not_read_as_street():
    """`St. Louis` is a place name, not an address line."""
    assert normalize_address("St. Louis, MO") == normalize_address("Saint Louis, MO")
    assert "street" not in normalize_address("St. Louis, MO")


def test_both_senses_of_st_in_one_address():
    """Saint precedes a name, Street follows one, in the same string."""
    abbreviated = normalize_address("44 St. Charles Ave, St. Louis, MO")
    spelled_out = normalize_address("44 Saint Charles Avenue, Saint Louis, MO")
    assert abbreviated == spelled_out
    assert "saint charles avenue" in abbreviated


def test_st_before_a_unit_word_is_still_a_street():
    """A word follows `St` here, but `Ste` is a suffix, not a place name."""
    assert normalize_address("120 Main St Ste 4") == normalize_address("120 Main Street Suite 4")


def test_directionals_expand_inside_a_street_line():
    assert normalize_address("120 N Main St") == normalize_address("120 North Main Street")


def test_directionals_are_left_alone_outside_a_street_line():
    """A bare `E` in a producer name is a name, not a compass point."""
    assert "east" not in normalize_address("E & J Gallo Winery")


def test_whisky_and_whiskey_are_the_same_designation():
    assert normalize_class_type("Blended Whisky") == normalize_class_type("Blended Whiskey")


def test_liquor_and_liqueur_are_different_designations():
    """Different products under 27 CFR 5. Folding them hides a real error."""
    assert normalize_class_type("Liqueur") != normalize_class_type("Liquor")


def test_token_sort_ignores_word_order():
    assert token_sort("kentucky straight bourbon") == token_sort("bourbon straight kentucky")


def test_normalize_handles_none_and_empty():
    assert normalize(None) == ""
    assert normalize("") == ""
