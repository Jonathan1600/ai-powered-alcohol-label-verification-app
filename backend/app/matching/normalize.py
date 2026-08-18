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

# Canonicalize toward the spelled-out form. Applied token by token, so only
# whole words match and "Sterling" is never mangled into "Streeterling".
_ADDRESS_FORMS = {
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
    "ste": "suite",
    "apt": "apartment",
    "n": "north",
    "s": "south",
    "e": "east",
    "w": "west",
    "ne": "northeast",
    "nw": "northwest",
    "se": "southeast",
    "sw": "southwest",
    "co": "company",
    "inc": "incorporated",
    "corp": "corporation",
    "ltd": "limited",
    "bros": "brothers",
    "mt": "mount",
    "ft": "fort",
}

# Spelling variants that are the same product designation. Scotch and Canadian
# producers spell it "whisky"; American and Irish ones "whiskey". Neither is a
# discrepancy worth an agent's attention.
_CLASS_TYPE_FORMS = {
    "whisky": "whiskey",
    "whiskies": "whiskey",
    "bourbon": "bourbon",
    "liquor": "liqueur",
    "vodkas": "vodka",
    "brandies": "brandy",
    "sparkling": "sparkling",
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


def _apply_forms(text: str, forms: dict[str, str]) -> str:
    """Substitute token by token, ignoring trailing punctuation on the lookup.

    Addresses arrive as `120 Main St, Bardstown`, so the token to match is `st`
    with a comma stuck to it. Trailing punctuation is set aside for the lookup
    and put back afterwards, which keeps both sides of a comparison aligned.
    """
    substituted = []
    for token in text.split():
        core = token.rstrip(".,;:")
        trailing = token[len(core) :]
        substituted.append(forms.get(core, core) + trailing)
    return " ".join(substituted)


def normalize_address(text: str | None) -> str:
    """Normalize plus expand address abbreviations: `123 Main St` -> `... street`."""
    return _apply_forms(normalize(text), _ADDRESS_FORMS)


def normalize_class_type(text: str | None) -> str:
    """Normalize plus fold product-designation spelling variants."""
    return _apply_forms(normalize(text), _CLASS_TYPE_FORMS)


def token_sort(text: str) -> str:
    """Sort tokens so word order stops mattering.

    `Kentucky Straight Bourbon` and `Straight Bourbon, Kentucky` designate the
    same product; only the ordering differs.
    """
    return " ".join(sorted(strip_punctuation(text).split()))
