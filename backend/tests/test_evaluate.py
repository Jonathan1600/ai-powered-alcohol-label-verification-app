"""Tests for the evaluation gate's policy, not its live model calls."""

from copy import deepcopy

from app.matching import verify
from app.matching.contracts import FieldName, OverallStatus, VerificationResult
from app.seed.loader import load_manifest
from tools.evaluate import check_gate, make_baseline, nearest_rank, score_result, summarize


def _fixture(identifier: str):
    return next(item for item in load_manifest().items if item.id == identifier)


def _healthy_report():
    fixture = _fixture("clean-bourbon-750")
    result = verify(fixture.application, fixture.ground_truth)
    outcome = score_result(fixture, result, {"model_ms": 1_000.0})
    return summarize([outcome], "local", "gpt-5.6-luna", "test-prompt")


def test_nearest_rank_uses_the_documented_p95_rule() -> None:
    # With 44 fixtures, p95 is the third slowest observation, not the max.
    values = [float(index) for index in range(1, 45)]
    assert nearest_rank(values, 0.50) == 22.0
    assert nearest_rank(values, 0.95) == 42.0


def test_score_includes_an_unexpected_conditional_field_as_an_error() -> None:
    fixture = _fixture("clean-bourbon-750")
    result = verify(fixture.application, fixture.ground_truth)
    result.fields.append(
        result.fields[0].model_copy(update={"field": FieldName.COUNTRY_OF_ORIGIN})
    )

    report = summarize(
        [score_result(fixture, result, {"model_ms": 1_000.0})],
        "local",
        "gpt-5.6-luna",
        "test-prompt",
    )

    assert report["accuracy"]["field_errors"] == 1
    assert report["accuracy"]["per_field"]["country_of_origin"]["total"] == 1


def test_gate_never_allows_a_known_problem_to_become_looks_correct() -> None:
    fixture = _fixture("warning-altered-wording")
    unsafe = VerificationResult(status=OverallStatus.LOOKS_CORRECT)
    report = summarize(
        [score_result(fixture, unsafe, {"model_ms": 1_000.0})],
        "local",
        "gpt-5.6-luna",
        "test-prompt",
    )
    baseline_report = _healthy_report()
    baseline = make_baseline(baseline_report)
    # The fixture corpus is part of a baseline's identity, so use the same
    # metadata while replacing only the measured outcomes in this policy test.
    report["manifest_sha256"] = baseline_report["manifest_sha256"]

    failures = check_gate(report, baseline)

    assert any("Unsafe false clears" in failure for failure in failures)


def test_gate_allows_the_explicit_small_regression_but_rejects_the_next_one() -> None:
    report = _healthy_report()
    baseline = make_baseline(report)
    one_more_status_error = deepcopy(report)
    one_more_status_error["accuracy"]["status_errors"] = 1
    assert check_gate(one_more_status_error, baseline) == []

    two_more_status_errors = deepcopy(report)
    two_more_status_errors["accuracy"]["status_errors"] = 2
    failures = check_gate(two_more_status_errors, baseline)
    assert any("Overall-status errors" in failure for failure in failures)


def test_gate_allows_a_new_prompt_version_against_the_reviewed_baseline() -> None:
    baseline_report = _healthy_report()
    baseline = make_baseline(baseline_report)
    new_prompt_report = deepcopy(baseline_report)
    new_prompt_report["prompt_version"] = "new-test-prompt"

    assert check_gate(new_prompt_report, baseline) == []


def test_gate_rejects_hard_baseline_identity_changes() -> None:
    report = _healthy_report()
    baseline = make_baseline(report)

    incompatible_schema_baseline = deepcopy(baseline)
    incompatible_schema_baseline["schema_version"] = 2
    schema_failures = check_gate(report, incompatible_schema_baseline)
    assert any("Baseline schema_version is incompatible" in failure for failure in schema_failures)

    for key, value in (("manifest_sha256", "different-fixtures"), ("model", "different-model")):
        changed_report = deepcopy(report)
        changed_report[key] = value

        failures = check_gate(changed_report, baseline)

        assert any(f"Baseline {key} is incompatible" in failure for failure in failures)


def test_accepting_a_report_records_its_prompt_version() -> None:
    baseline_report = _healthy_report()
    baseline = make_baseline(baseline_report)
    reviewed_report = deepcopy(baseline_report)
    reviewed_report["prompt_version"] = "new-test-prompt"

    updated_baseline = make_baseline(reviewed_report, baseline)

    assert updated_baseline["prompt_version"] == "new-test-prompt"


def test_baseline_p95_limit_is_twenty_five_percent_with_100ms_rounding() -> None:
    report = _healthy_report()
    report["latency"]["p95_ms"] = 1_001.0
    baseline = make_baseline(report)
    assert baseline["targets"]["local"]["p95_limit_ms"] == 1_300.0
