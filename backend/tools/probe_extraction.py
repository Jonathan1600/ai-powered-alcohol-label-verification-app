"""Run one fixture through the real model and show the reading beside the truth.

The prompt is the only accuracy lever this project has (ADR-008), so iterating on
it needs a loop tighter than the test suite: something that shows what changed
rather than reporting pass or fail. That is all this is.

Deliberately small. Phase 8 builds the evaluation script that scores the whole
corpus and enforces the latency gate, and this should be replaced by it rather
than grown into it.

    uv run python -m tools.probe_extraction clean-bourbon-750
    uv run python -m tools.probe_extraction --all-warnings
"""

import argparse
import sys
import time

from dotenv import load_dotenv

from app.config import REPO_ROOT, get_settings
from app.matching import verify
from app.matching.contracts import ExtractedLabel
from app.seed.loader import FIXTURE_DIR, load_manifest
from app.seed.models import SeedFixture

load_dotenv(REPO_ROOT / ".env")

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def normalize(text: str | None) -> str:
    return " ".join((text or "").split())


def compare(label: str, got: str | None, truth: str | None) -> str:
    """One line showing a reading against ground truth."""
    same = normalize(got) == normalize(truth)
    mark = f"{GREEN}ok{RESET}" if same else f"{RED}differs{RESET}"
    line = f"  {label:22} {mark}  {got!r}"
    if not same:
        line += f"\n  {'':22} {DIM}truth{RESET}    {truth!r}"
    return line


def probe(fixture: SeedFixture, extraction: ExtractedLabel, elapsed_ms: float) -> bool:
    """Print the comparison and return whether the status matched expectation."""
    truth = fixture.ground_truth
    print(f"\n{fixture.id}  {DIM}({fixture.degradation}, {elapsed_ms:.0f} ms){RESET}")
    print(f"  {DIM}{fixture.probes}{RESET}")

    if extraction.readability.unreadable or truth.readability.unreadable:
        print(
            f"  readability            got unreadable="
            f"{extraction.readability.unreadable} reason={extraction.readability.reason}"
            f"  {DIM}truth unreadable={truth.readability.unreadable}{RESET}"
        )

    for name in ("brand_name", "class_type", "alcohol_content", "net_contents", "bottler_info"):
        print(compare(name, getattr(extraction, name).verbatim, getattr(truth, name).verbatim))

    warning, warning_truth = extraction.government_warning, truth.government_warning
    print(compare("warning", warning.verbatim, warning_truth.verbatim))
    print(
        f"  {'warning typography':22} bold_prefix={warning.prefix_is_bold} "
        f"bold_rest={warning.remainder_is_bold} "
        f"size={warning.estimated_type_size_mm}mm "
        f"{DIM}truth size={warning_truth.estimated_type_size_mm}mm{RESET}"
    )

    result = verify(fixture.application, extraction)
    matched = result.status is fixture.expected.status
    colour = GREEN if matched else RED
    print(
        f"  {'status':22} {colour}{result.status.value}{RESET}  "
        f"{DIM}expected {fixture.expected.status.value}{RESET}"
    )
    if not matched:
        for field in result.fields:
            if field.verdict.value != "match":
                print(f"    {YELLOW}{field.field.value}{RESET}: {field.reason}")
    return matched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", nargs="*", help="Fixture ids to probe.")
    parser.add_argument(
        "--all-warnings",
        action="store_true",
        help="Probe every government warning fixture, the highest-risk group.",
    )
    parser.add_argument(
        "--unreadable",
        action="store_true",
        help="Probe the degraded fixtures, which are the ones that must fail to read.",
    )
    args = parser.parse_args()

    manifest = load_manifest()
    by_id = {item.id: item for item in manifest.items}

    selected = list(args.fixture)
    if args.all_warnings:
        selected += [i.id for i in manifest.items if i.id.startswith("warning-")]
    if args.unreadable:
        selected += [i.id for i in manifest.items if i.id.startswith("unreadable-")]
    if not selected:
        parser.error("Name at least one fixture, or pass --all-warnings or --unreadable.")

    unknown = [name for name in selected if name not in by_id]
    if unknown:
        parser.error(f"No such fixture: {', '.join(unknown)}")

    # Imported here so `--help` works without an API key present.
    from app.readers.openai_reader import build_reader

    reader = build_reader(get_settings())

    agreed, timings = 0, []
    for fixture_id in selected:
        fixture = by_id[fixture_id]
        started = time.perf_counter()
        extraction = reader.read((FIXTURE_DIR / fixture.image).read_bytes())
        elapsed = (time.perf_counter() - started) * 1000
        timings.append(elapsed)
        agreed += probe(fixture, extraction, elapsed)

    timings.sort()
    print(
        f"\n{agreed}/{len(selected)} matched the expected status.  "
        f"median {timings[len(timings) // 2]:.0f} ms, slowest {timings[-1]:.0f} ms"
    )
    # Never a non-zero exit on a disagreement. This is a diagnostic tool, and the
    # gate that blocks a build is phase 8's, scored across the whole corpus.
    return 0


if __name__ == "__main__":
    sys.exit(main())
