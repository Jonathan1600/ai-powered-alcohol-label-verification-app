"""Evaluate the live reader against the hand-authored fixture corpus.

This is intentionally a small command-line tool, not another product surface.
The reviewer-facing application already has the queue and review views; this
tool exists for engineers to detect a model, prompt, or latency regression.

There are two measurement boundaries:

* ``local`` calls the real reader from the CI runner. It is the merge gate for
  code that has not been deployed yet and measures model-call latency.
* ``deployed`` posts the fixtures to Render's existing verify endpoint. It is a
  post-deploy check that measures the deployed backend round trip as well as
  the server's already-instrumented stages.

Neither boundary pretends to include browser downscaling or rendering. Keeping
that distinction explicit is more useful than producing one misleading number.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv

from app.config import REPO_ROOT, get_settings
from app.matching import verify
from app.matching.contracts import ExtractedLabel, OverallStatus, VerificationResult
from app.readers.openai_reader import build_reader
from app.readers.prompt import PROMPT_VERSION
from app.seed.loader import FIXTURE_DIR, MANIFEST_FILE, load_manifest
from app.seed.models import SeedFixture
from app.verify.models import VerifyResponse

BASELINE_SCHEMA_VERSION = 1
DEFAULT_BASELINE = FIXTURE_DIR / "evaluation_baseline.json"
WARMUP_FIXTURE_ID = "clean-bourbon-750"
LATENCY_ALLOWANCE = 1.25
STATUS_ERROR_ALLOWANCE = 1
FIELD_ERROR_ALLOWANCE = 5

Target = Literal["local", "deployed"]

# The API process loads the shared root .env in app.main. This command runs the
# reader directly, so it must do the same before the SDK constructs its client.
# Keep this beside the import path rather than relying on a caller to export the
# key manually; tools.probe_extraction follows the identical convention.
load_dotenv(REPO_ROOT / ".env")


@dataclass
class FieldOutcome:
    field: str
    expected: str | None
    actual: str | None


@dataclass
class FixtureOutcome:
    fixture_id: str
    expected_status: str
    actual_status: str | None
    expected_unreadable_reason: str | None
    actual_unreadable_reason: str | None
    fields: list[FieldOutcome] = field(default_factory=list)
    timings_ms: dict[str, float] = field(default_factory=dict)
    calibration: dict[str, Any] | None = None
    error: str | None = None


def manifest_sha256() -> str:
    """Fingerprint the immutable corpus a baseline is allowed to describe."""
    return hashlib.sha256(MANIFEST_FILE.read_bytes()).hexdigest()


def nearest_rank(values: list[float], percentile: float) -> float:
    """Return a percentile using the documented nearest-rank method."""
    if not values:
        raise ValueError("Cannot calculate a percentile with no observations.")
    if not 0 < percentile <= 1:
        raise ValueError("percentile must be in (0, 1].")
    ordered = sorted(values)
    return ordered[math.ceil(percentile * len(ordered)) - 1]


def _field_outcomes(fixture: SeedFixture, result: VerificationResult) -> list[FieldOutcome]:
    expected = {item.field.value: item.verdict.value for item in fixture.expected.fields}
    actual = {item.field.value: item.verdict.value for item in result.fields}
    return [
        FieldOutcome(name, expected.get(name), actual.get(name))
        for name in sorted(set(expected) | set(actual))
    ]


def _calibration_observation(fixture: SeedFixture, extraction: ExtractedLabel) -> dict[str, Any]:
    """Keep only the signals needed to calibrate documented soft checks."""
    observed_warning = extraction.government_warning
    expected_warning = fixture.ground_truth.government_warning
    confidences = [
        extraction.brand_name.confidence,
        extraction.class_type.confidence,
        extraction.alcohol_content.confidence,
        extraction.net_contents.confidence,
        extraction.bottler_info.confidence,
        extraction.country_of_origin.confidence,
        observed_warning.confidence,
    ]
    return {
        "confidences": confidences,
        "warning_type_size": {
            "expected_mm": expected_warning.estimated_type_size_mm,
            "actual_mm": observed_warning.estimated_type_size_mm,
        },
        "warning_bold": {
            "expected_prefix": expected_warning.prefix_is_bold,
            "actual_prefix": observed_warning.prefix_is_bold,
            "expected_remainder": expected_warning.remainder_is_bold,
            "actual_remainder": observed_warning.remainder_is_bold,
        },
    }


def score_result(
    fixture: SeedFixture,
    result: VerificationResult,
    timings_ms: dict[str, float],
    extraction: ExtractedLabel | None = None,
) -> FixtureOutcome:
    """Compare one live outcome to authored fixture expectations."""
    return FixtureOutcome(
        fixture_id=fixture.id,
        expected_status=fixture.expected.status.value,
        actual_status=result.status.value,
        expected_unreadable_reason=(
            fixture.expected.unreadable_reason.value if fixture.expected.unreadable_reason else None
        ),
        actual_unreadable_reason=result.unreadable_reason.value if result.unreadable_reason else None,
        fields=_field_outcomes(fixture, result),
        timings_ms=timings_ms,
        calibration=_calibration_observation(fixture, extraction) if extraction else None,
    )


def failed_fixture(fixture: SeedFixture, error: Exception | str) -> FixtureOutcome:
    return FixtureOutcome(
        fixture_id=fixture.id,
        expected_status=fixture.expected.status.value,
        actual_status=None,
        expected_unreadable_reason=(
            fixture.expected.unreadable_reason.value if fixture.expected.unreadable_reason else None
        ),
        actual_unreadable_reason=None,
        error=str(error),
    )


def _read_fixture_image(fixture: SeedFixture) -> bytes:
    return (FIXTURE_DIR / fixture.image).read_bytes()


def run_local(fixtures: list[SeedFixture]) -> tuple[list[FixtureOutcome], str | None, str]:
    """Call the real reader directly; used by the merge gate before deployment."""
    settings = get_settings()
    reader = build_reader(settings)
    fixture_by_id = {fixture.id: fixture for fixture in fixtures}
    warmup_error: str | None = None
    warmup = fixture_by_id.get(WARMUP_FIXTURE_ID)
    if warmup is None:
        raise RuntimeError(f"Warm-up fixture {WARMUP_FIXTURE_ID!r} is not in the manifest.")
    try:
        reader.read(_read_fixture_image(warmup))
    except Exception as error:  # noqa: BLE001 - one bad provider call must not hide the corpus report.
        warmup_error = str(error)

    outcomes: list[FixtureOutcome] = []
    for fixture in fixtures:
        started = time.perf_counter()
        try:
            model_started = time.perf_counter()
            extraction = reader.read(_read_fixture_image(fixture))
            model_ms = (time.perf_counter() - model_started) * 1000
            matching_started = time.perf_counter()
            result = verify(fixture.application, extraction)
            matching_ms = (time.perf_counter() - matching_started) * 1000
            outcomes.append(
                score_result(
                    fixture,
                    result,
                    {
                        "model_ms": model_ms,
                        "matching_ms": matching_ms,
                        "total_ms": (time.perf_counter() - started) * 1000,
                    },
                    extraction,
                )
            )
        except Exception as error:  # noqa: BLE001 - report every failed fixture, once.
            outcomes.append(failed_fixture(fixture, error))
    return outcomes, warmup_error, settings.openai_model


def run_deployed(
    fixtures: list[SeedFixture], base_url: str
) -> tuple[list[FixtureOutcome], str | None, str | None, str | None]:
    """Measure the deployed endpoint once per fixture, sequentially and without retries."""
    base_url = base_url.rstrip("/")
    warmup_error: str | None = None
    model: str | None = None
    prompt_version: str | None = None

    def post(client: httpx.Client, fixture: SeedFixture) -> tuple[VerifyResponse, float]:
        started = time.perf_counter()
        response = client.post(
            f"{base_url}/api/verify",
            data={"application": fixture.application.model_dump_json()},
            files={"image": (Path(fixture.image).name, _read_fixture_image(fixture), "image/png")},
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.raise_for_status()
        return VerifyResponse.model_validate(response.json()), elapsed_ms

    fixture_by_id = {fixture.id: fixture for fixture in fixtures}
    warmup = fixture_by_id.get(WARMUP_FIXTURE_ID)
    if warmup is None:
        raise RuntimeError(f"Warm-up fixture {WARMUP_FIXTURE_ID!r} is not in the manifest.")

    outcomes: list[FixtureOutcome] = []
    with httpx.Client(timeout=45.0) as client:
        try:
            warm_response, _ = post(client, warmup)
            model = warm_response.model
            prompt_version = warm_response.prompt_version
        except Exception as error:  # noqa: BLE001 - preserve the failed warm-up in the report.
            warmup_error = str(error)

        for fixture in fixtures:
            try:
                response, round_trip_ms = post(client, fixture)
                model = model or response.model
                prompt_version = prompt_version or response.prompt_version
                outcomes.append(
                    score_result(
                        fixture,
                        response.result,
                        {
                            "round_trip_ms": round_trip_ms,
                            "read_ms": response.timings.read_ms,
                            "model_ms": response.timings.model_ms,
                            "matching_ms": response.timings.matching_ms,
                            "server_total_ms": response.timings.server_total_ms,
                        },
                    )
                )
            except Exception as error:  # noqa: BLE001 - one endpoint failure must not abort diagnosis.
                outcomes.append(failed_fixture(fixture, error))
    return outcomes, warmup_error, model, prompt_version


def _calibration(fixtures: list[SeedFixture], outcomes: list[FixtureOutcome]) -> dict[str, Any]:
    """Expose soft-signal evidence without using it as a brittle gate."""
    del fixtures
    confidences: list[float] = []
    type_errors: list[float] = []
    type_biases: list[float] = []
    bold_total = 0
    bold_correct = 0
    for outcome in outcomes:
        observation = outcome.calibration
        if not observation:
            continue
        confidences.extend(observation["confidences"])
        type_size = observation["warning_type_size"]
        if type_size["expected_mm"] is not None and type_size["actual_mm"] is not None:
            bias = type_size["actual_mm"] - type_size["expected_mm"]
            type_biases.append(bias)
            type_errors.append(abs(bias))
        bold = observation["warning_bold"]
        for expected, actual in (
            (bold["expected_prefix"], bold["actual_prefix"]),
            (bold["expected_remainder"], bold["actual_remainder"]),
        ):
            if expected is not None:
                bold_total += 1
                bold_correct += expected == actual
    if not confidences:
        return {
            "available": False,
            "note": (
                "The deployed verify response deliberately omits raw extraction, so confidence, "
                "bold, and type-size calibration are available only from the local reader run."
            ),
        }
    return {
        "available": True,
        "confidence": {
            "count": len(confidences),
            "min": min(confidences),
            "p50": nearest_rank(confidences, 0.50),
            "max": max(confidences),
        },
        "warning_type_size_mm": {
            "count": len(type_errors),
            "mean_absolute_error": sum(type_errors) / len(type_errors) if type_errors else None,
            "mean_bias": sum(type_biases) / len(type_biases) if type_biases else None,
            "max_absolute_error": max(type_errors) if type_errors else None,
        },
        "warning_bold": {
            "correct": bold_correct,
            "total": bold_total,
            "accuracy": bold_correct / bold_total if bold_total else None,
        },
    }


def summarize(
    outcomes: list[FixtureOutcome], target: Target, model: str | None, prompt_version: str | None
) -> dict[str, Any]:
    """Turn fixture outcomes into the stable report and gate input."""
    field_totals: Counter[str] = Counter()
    field_correct: Counter[str] = Counter()
    status_errors = 0
    field_errors = 0
    unreadable_reason_errors = 0
    unsafe_false_clears: list[str] = []
    failed = [outcome.fixture_id for outcome in outcomes if outcome.error]

    for outcome in outcomes:
        if outcome.error:
            continue
        if outcome.actual_status != outcome.expected_status:
            status_errors += 1
        if (
            outcome.expected_status in {
                OverallStatus.PROBLEM_FOUND.value,
                OverallStatus.UNREADABLE.value,
            }
            and outcome.actual_status == OverallStatus.LOOKS_CORRECT.value
        ):
            unsafe_false_clears.append(outcome.fixture_id)
        if (
            outcome.expected_status == OverallStatus.UNREADABLE.value
            and outcome.actual_status == OverallStatus.UNREADABLE.value
            and outcome.expected_unreadable_reason != outcome.actual_unreadable_reason
        ):
            unreadable_reason_errors += 1
        for field_outcome in outcome.fields:
            # An unexpected actual field is a mismatch as well: it can reveal a
            # conditional-field regression that a simple zip() would conceal.
            field_totals[field_outcome.field] += 1
            if field_outcome.expected == field_outcome.actual:
                field_correct[field_outcome.field] += 1
            else:
                field_errors += 1

    latency_name = "model_ms" if target == "local" else "round_trip_ms"
    latency_values = [
        outcome.timings_ms[latency_name]
        for outcome in outcomes
        if not outcome.error and latency_name in outcome.timings_ms
    ]
    stage_values: dict[str, list[float]] = defaultdict(list)
    for outcome in outcomes:
        if not outcome.error:
            for stage, elapsed_ms in outcome.timings_ms.items():
                stage_values[stage].append(elapsed_ms)
    total_fields = sum(field_totals.values())
    completed = len(outcomes) - len(failed)
    field_metrics = {
        name: {
            "correct": field_correct[name],
            "total": field_totals[name],
            "accuracy": field_correct[name] / field_totals[name],
        }
        for name in sorted(field_totals)
    }
    return {
        "schema_version": BASELINE_SCHEMA_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "target": target,
        "manifest_sha256": manifest_sha256(),
        "model": model,
        "prompt_version": prompt_version,
        "fixture_count": len(outcomes),
        "completed_count": completed,
        "failed_fixture_ids": failed,
        "warmup_fixture_id": WARMUP_FIXTURE_ID,
        "accuracy": {
            "status_errors": status_errors,
            "status_accuracy": (completed - status_errors) / completed if completed else 0.0,
            "field_errors": field_errors,
            "field_total": total_fields,
            "field_accuracy": (total_fields - field_errors) / total_fields if total_fields else 0.0,
            "unreadable_reason_errors": unreadable_reason_errors,
            "unsafe_false_clears": unsafe_false_clears,
            "per_field": field_metrics,
        },
        "latency": {
            "metric": latency_name,
            "observation_count": len(latency_values),
            "p50_ms": nearest_rank(latency_values, 0.50) if latency_values else None,
            "p95_ms": nearest_rank(latency_values, 0.95) if latency_values else None,
        },
        "stages": {
            stage: {
                "observation_count": len(values),
                "p50_ms": nearest_rank(values, 0.50),
                "p95_ms": nearest_rank(values, 0.95),
            }
            for stage, values in sorted(stage_values.items())
        },
        "fixtures": [asdict(outcome) for outcome in outcomes],
    }


def _round_up_100(value: float) -> float:
    return math.ceil(value / 100.0) * 100.0


def make_baseline(report: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Create one reviewed baseline entry; callers must explicitly write it."""
    if report["failed_fixture_ids"]:
        raise ValueError("Cannot accept a baseline with fixture extraction failures.")
    if report["accuracy"]["unsafe_false_clears"]:
        raise ValueError("Cannot accept a baseline with unsafe false clears.")
    p95 = report["latency"]["p95_ms"]
    if p95 is None:
        raise ValueError("Cannot accept a baseline without latency observations.")

    baseline = existing or {
        "schema_version": BASELINE_SCHEMA_VERSION,
        "manifest_sha256": report["manifest_sha256"],
        "model": report["model"],
        "prompt_version": report["prompt_version"],
        "targets": {},
    }
    for key in ("schema_version", "manifest_sha256", "model"):
        if baseline.get(key) != (BASELINE_SCHEMA_VERSION if key == "schema_version" else report[key]):
            raise ValueError(f"Existing baseline {key} differs; create a new reviewed baseline instead.")

    # Prompt versions are retained as review metadata, not baseline identity: prompt
    # changes must continue to be evaluated against the approved safety and quality
    # thresholds without requiring a new baseline on every pull request.
    baseline["prompt_version"] = report["prompt_version"]
    baseline["targets"][report["target"]] = {
        "approved_at": report["created_at"],
        "status_error_baseline": report["accuracy"]["status_errors"],
        "field_error_baseline": report["accuracy"]["field_errors"],
        "p95_metric": report["latency"]["metric"],
        "p95_baseline_ms": p95,
        "p95_limit_ms": _round_up_100(p95 * LATENCY_ALLOWANCE),
    }
    return baseline


def check_gate(report: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    """Return explicit failures instead of hiding a regression behind one exit code."""
    failures: list[str] = []
    for key in ("schema_version", "manifest_sha256", "model"):
        expected = BASELINE_SCHEMA_VERSION if key == "schema_version" else report[key]
        if baseline.get(key) != expected:
            failures.append(
                f"Baseline {key} is incompatible with this run "
                f"(baseline={baseline.get(key)!r}, run={expected!r})."
            )
    target_baseline = baseline.get("targets", {}).get(report["target"])
    if not target_baseline:
        failures.append(f"Baseline has no approved {report['target']} target entry.")
        return failures

    if report["failed_fixture_ids"]:
        failures.append(
            "Fixture extraction/endpoint failures: " + ", ".join(report["failed_fixture_ids"])
        )
    false_clears = report["accuracy"]["unsafe_false_clears"]
    if false_clears:
        failures.append("Unsafe false clears: " + ", ".join(false_clears))
    status_limit = target_baseline["status_error_baseline"] + STATUS_ERROR_ALLOWANCE
    if report["accuracy"]["status_errors"] > status_limit:
        failures.append(
            f"Overall-status errors {report['accuracy']['status_errors']} exceed "
            f"baseline allowance {status_limit}."
        )
    field_limit = target_baseline["field_error_baseline"] + FIELD_ERROR_ALLOWANCE
    if report["accuracy"]["field_errors"] > field_limit:
        failures.append(
            f"Field-verdict errors {report['accuracy']['field_errors']} exceed "
            f"baseline allowance {field_limit}."
        )
    p95 = report["latency"]["p95_ms"]
    if p95 is None:
        failures.append("No latency observations were recorded.")
    elif report["latency"]["metric"] != target_baseline["p95_metric"]:
        failures.append("Latency metric does not match the approved target baseline.")
    elif p95 > target_baseline["p95_limit_ms"]:
        failures.append(
            f"p95 {p95:.1f}ms exceeds approved {target_baseline['p95_limit_ms']:.1f}ms."
        )
    return failures


def _load_baseline(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(
            f"No approved evaluation baseline at {path}. Run this command once with "
            "--accept-baseline after reviewing a healthy live report."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def print_summary(
    report: dict[str, Any], failures: list[str], warmup_error: str | None, report_only: bool = False
) -> None:
    accuracy = report["accuracy"]
    latency = report["latency"]
    print(f"Evaluation target: {report['target']} ({report['fixture_count']} fixtures)")
    print(f"Model/prompt: {report['model']} / {report['prompt_version']}")
    print(
        "Accuracy: "
        f"status {accuracy['status_accuracy']:.1%} ({accuracy['status_errors']} errors), "
        f"fields {accuracy['field_accuracy']:.1%} ({accuracy['field_errors']} errors)"
    )
    if latency["p95_ms"] is not None:
        print(
            f"Latency ({latency['metric']}): p50={latency['p50_ms']:.1f}ms, "
            f"p95={latency['p95_ms']:.1f}ms ({latency['observation_count']} observations)"
        )
    if warmup_error:
        print(f"Warm-up failed: {warmup_error}")
    if report_only:
        print("Report only: no approved baseline exists yet. Review this report, then accept it.")
    elif failures:
        print("Gate failed:")
        for failure in failures:
            print(f"- {failure}")
        print("Stage timing breakdown:")
        for stage, values in report["stages"].items():
            print(f"- {stage}: p50={values['p50_ms']:.1f}ms, p95={values['p95_ms']:.1f}ms")
    else:
        print("Gate passed.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "deployed"), default="local")
    parser.add_argument("--base-url", help="Render API base URL; required for --target deployed.")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--json-output", type=Path, help="Write the full report to this path.")
    acceptance = parser.add_mutually_exclusive_group()
    acceptance.add_argument(
        "--accept-baseline",
        action="store_true",
        help="Write/update the selected target baseline after a reviewed healthy run.",
    )
    acceptance.add_argument(
        "--accept-report",
        type=Path,
        help="Accept a previously reviewed JSON report without making live calls again.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.accept_report:
        try:
            report = json.loads(args.accept_report.read_text(encoding="utf-8"))
            existing = _load_baseline(args.baseline) if args.baseline.exists() else None
            baseline = make_baseline(report, existing)
            _write_json(args.baseline, baseline)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"Could not accept report: {error}", file=sys.stderr)
            return 1
        print(f"Approved {report['target']} baseline written to {args.baseline}.")
        return 0

    fixtures = load_manifest().items
    if args.target == "local":
        outcomes, warmup_error, model = run_local(fixtures)
        prompt_version = PROMPT_VERSION
    else:
        base_url = args.base_url or os.environ.get("EVALUATION_API_BASE_URL")
        if not base_url:
            print("--base-url or EVALUATION_API_BASE_URL is required for deployed evaluation.", file=sys.stderr)
            return 2
        outcomes, warmup_error, model, prompt_version = run_deployed(fixtures, base_url)

    report = summarize(outcomes, args.target, model, prompt_version)
    report["warmup_error"] = warmup_error
    report["calibration"] = _calibration(fixtures, outcomes)
    if args.json_output:
        _write_json(args.json_output, report)

    report_only = False
    if args.accept_baseline:
        try:
            existing = _load_baseline(args.baseline) if args.baseline.exists() else None
            baseline = make_baseline(report, existing)
            _write_json(args.baseline, baseline)
        except (OSError, ValueError) as error:
            print(f"Could not accept baseline: {error}", file=sys.stderr)
            return 1
        print(f"Approved {args.target} baseline written to {args.baseline}.")
        # A failed warm-up makes the run unsuitable as a baseline even when the
        # remaining calls succeeded; it proves the connection was not healthy.
        failures = [f"Warm-up failed: {warmup_error}"] if warmup_error else []
    else:
        try:
            failures = check_gate(report, _load_baseline(args.baseline))
        except FileNotFoundError:
            # A developer's first measurement is evidence to review, not a
            # failed gate. CI has an earlier baseline preflight and therefore
            # still cannot pass without an approved committed baseline.
            failures = []
            report_only = True
        except (OSError, ValueError, json.JSONDecodeError) as error:
            failures = [str(error)]
    print_summary(report, failures, warmup_error, report_only=report_only)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
