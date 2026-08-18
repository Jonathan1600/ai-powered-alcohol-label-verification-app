"""Shared text normalization.

`STONE'S THROW` and `Stone's Throw` differ by capitalization and by a curly
versus straight apostrophe. Both differences are meaningless on a label and both
are erased here, which is what keeps that case out of the review queue.

Order matters: NFKC first so compatibility forms collapse, then the character
folds, then whitespace, and case folding last so every earlier step sees
predictable input.
"""

import re
import unicodedata

# NFKC leaves these alone, so they are mapped explicitly.
_QUOTE_FOLD = {
    "‘": "'",  # left single quote
    "’": "'",  # right single quote, the apostrophe in STONE'S THROW
    "‚": "'",
    "‛": "'",
    "′": "'",  # prime
    "“": '"',
    "”": '"',
    "„": '"',
    "‟": '"',
    "″": '"',  # double prime
    "–": "-",  # en dash
    "—": "-",  # em dash
    "−": "-",  # minus sign
}

_WHITESPACE = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[^\w\s]")

# Trailing punctuation is dropped rather than preserved, because `St.` and
# `Street` have to land on the same token for the exact-match tier to fire.
_EDGE_PUNCTUATION = ".,;:"

# Canonicalize toward the spelled-out form. Every table below is applied token
# by token, so only whole words match and `Sterling` is never mangled into
# `Streeterling`.
_STREET_SUFFIXES = {
    "st": "street",
    "ave": "avenue",
    "av": "avenue",
    "rd": "road",
    "blvd": "boulevard",
    "hwy": "highway",
    "ln": "lane",
    "dr": "drive",
    "ct": "court",
    "pl": "place",
    "sq": "square",
}

_UNIT_FORMS = {
    "ste": "suite",
    "apt": "apartment",
}

# `St.` is a street suffix in `120 Main St` and an abbreviation of Saint in
# `St. Louis`. Position decides which, so these are kept apart from the suffix
# table rather than merged into it.
_PLACE_PREFIXES = {
    "st": "saint",
    "mt": "mount",
    "ft": "fort",
}

# Only expanded inside a street line. A bare `E` is east in `120 E Main St` and
# a name in `E & J Gallo`, and there is no way to tell the two apart by token.
_DIRECTIONALS = {
    "n": "north",
    "s": "south",
    "e": "east",
    "w": "west",
    "ne": "northeast",
    "nw": "northwest",
    "se": "southeast",
    "sw": "southwest",
}

# Unambiguous wherever they appear, so these need no positional rule.
_ENTITY_FORMS = {
    "co": "company",
    "inc": "incorporated",
    "corp": "corporation",
    "ltd": "limited",
    "bros": "brothers",
}

# Both the abbreviated and the spelled-out forms, since a place prefix is
# decided by what follows it and the following token may already be expanded.
_SUFFIX_WORDS = (
    set(_STREET_SUFFIXES)
    | set(_STREET_SUFFIXES.values())
    | set(_UNIT_FORMS)
    | set(_UNIT_FORMS.values())
)

# Spelling variants that are the same product designation. Scotch and Canadian
# producers spell it "whisky"; American and Irish ones "whiskey". Neither is a
# discrepancy worth an agent's attention. Designations that merely look similar
# are deliberately absent: `liquor` and `liqueur` are different products and
# folding them together would hide a real class or type error.
_CLASS_TYPE_FORMS = {
    "whisky": "whiskey",
    "whiskies": "whiskey",
    "whiskeys": "whiskey",
    "vodkas": "vodka",
    "brandies": "brandy",
    "spirit": "spirits",
}


def normalize(text: str | None) -> str:
    """Fold away differences that never make two labels genuinely disagree."""
    if not text:
        return ""
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(_QUOTE_FOLD.get(char, char) for char in folded)
    folded = _WHITESPACE.sub(" ", folded).strip()
    return folded.casefold()


def collapse_whitespace(text: str | None) -> str:
    """Normalize spacing without touching case.

    The government warning path needs this: line breaks on a label are an
    artifact of layout, but capitalization is regulated and must survive.
    """
    if not text:
        return ""
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(_QUOTE_FOLD.get(char, char) for char in folded)
    return _WHITESPACE.sub(" ", folded).strip()


def strip_punctuation(text: str) -> str:
    """Drop punctuation for the fuzzy pass only.

    Deliberately not part of `normalize`, so that the exact-match tier keeps
    meaning something.
    """
    return _WHITESPACE.sub(" ", _PUNCTUATION.sub(" ", text)).strip()


def _tokenize(text: str) -> list[str]:
    """Split into tokens with trailing punctuation removed.

    Dropping the punctuation rather than restoring it is what lets `120 Main St.`
    and `120 Main Street` reach the same string. Both sides of a comparison are
    tokenized identically, so nothing is lost by discarding it.
    """
    tokens = [token.rstrip(_EDGE_PUNCTUATION) for token in text.split()]
    return [token for token in tokens if token]


def _reads_as_place_prefix(index: int, tokens: list[str]) -> bool:
    """True when `St` abbreviates Saint rather than Street.

    Saint precedes a name; Street follows one. So a place prefix is a token with
    a plain word after it, and anything that ends an address line, or that is
    followed by `Suite` or another suffix, is the street sense.
    """
    if index + 1 >= len(tokens):
        return False
    following = tokens[index + 1]
    return following.isalpha() and following not in _SUFFIX_WORDS


def _expand_address_segment(segment: str) -> list[str]:
    """Expand one comma-delimited piece of an address."""
    tokens = _tokenize(segment)
    # `120 Main St` is a street line; `Stone's Throw Distillery` is not. Only
    # the former gets directional expansion.
    is_street_line = bool(tokens) and tokens[0][0].isdigit()

    expanded = []
    for index, token in enumerate(tokens):
        if token in _ENTITY_FORMS:
            expanded.append(_ENTITY_FORMS[token])
        elif token in _PLACE_PREFIXES and _reads_as_place_prefix(index, tokens):
            expanded.append(_PLACE_PREFIXES[token])
        elif token in _STREET_SUFFIXES:
            expanded.append(_STREET_SUFFIXES[token])
        elif token in _UNIT_FORMS:
            expanded.append(_UNIT_FORMS[token])
        elif is_street_line and token in _DIRECTIONALS:
            expanded.append(_DIRECTIONALS[token])
        else:
            expanded.append(token)
    return expanded


def normalize_address(text: str | None) -> str:
    """Normalize plus expand address abbreviations: `123 Main St` -> `... street`.

    Segments are split on commas because position within a line is what
    disambiguates `St`, and the commas themselves carry no meaning once both
    sides are treated the same way.
    """
    words: list[str] = []
    for segment in normalize(text).split(","):
        words.extend(_expand_address_segment(segment))
    return " ".join(words)


def normalize_class_type(text: str | None) -> str:
    """Normalize plus fold product-designation spelling variants."""
    tokens = _tokenize(normalize(text))
    return " ".join(_CLASS_TYPE_FORMS.get(token, token) for token in tokens)


def token_sort(text: str) -> str:
    """Sort tokens so word order stops mattering.

    `Kentucky Straight Bourbon` and `Straight Bourbon, Kentucky` designate the
    same product; only the ordering differs.
    """
    return " ".join(sorted(strip_punctuation(text).split()))
