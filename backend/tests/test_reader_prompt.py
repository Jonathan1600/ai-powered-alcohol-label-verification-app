"""The reader's safety-critical human-legibility instructions."""

from app.readers.prompt import PROMPT_VERSION, SYSTEM_PROMPT
from app.readers.schema import ObservedReadability


def test_prompt_requires_human_legibility_before_transcription() -> None:
    lowered = SYSTEM_PROMPT.lower()
    assert "human reviewer can directly see" in lowered
    assert "before transcribing anything" in lowered
    assert "choose unreadable" in lowered
    assert "do not infer, complete, or reconstruct" in lowered


def test_readability_schema_uses_the_same_human_legibility_standard() -> None:
    description = ObservedReadability.model_fields["unreadable"].description
    assert description is not None
    assert "hard for a human to read directly" in description
    assert "Do not infer or reconstruct obscured text" in description


def test_prompt_defines_one_primary_unreadable_reason() -> None:
    lowered = SYSTEM_PROMPT.lower()
    assert "return exactly one primary reason" in lowered
    assert "glare, then angle, then blur" in lowered

    description = ObservedReadability.model_fields["reason"].description
    assert description is not None
    assert "one primary physical defect" in description
    assert "glare for bright reflection" in description


def test_prompt_version_changes_with_the_human_legibility_rule() -> None:
    assert PROMPT_VERSION == "2026-08-20.1"
