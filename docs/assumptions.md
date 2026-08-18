# Assumptions and Calibration Record

Every number the matching engine relies on, where it came from, and how much
weight it can carry. Design rationale lives in [approach.md](./approach.md),
structure and decision records in [architecture.md](./architecture.md), and the
sequence of work in [build-plan.md](./build-plan.md). This document exists so
that a reviewer can tell, at a glance, which constants are law and which are
engineering guesses waiting on evidence.

The distinction matters more than the values. A wrong regulatory citation is a
correctness bug. A wrong threshold is a tuning problem, and phase 8 is where the
tuning gets measured.

---

## 1. How the regulatory values were verified

All CFR values were read from the Cornell Law School CFR mirror on 2026-08-18.
The authoritative source, eCFR, blocks automated fetches and returns a redirect
to an unblock page, so it could not be read directly during implementation.

**This is worth one manual check.** Cornell mirrors the CFR faithfully but is
not the system of record. Before the submission is final, open eCFR by hand and
confirm the five citations in section 2 still read as written here. The
citations are carried in code comments next to each constant precisely so that
this check is mechanical.

Two of the three alcohol-content citations point at parts renumbered in the 2020
labeling modernization rule. Older references to 27 CFR 5.37 and 7.71 that
circulate online now resolve to different content. The values below are taken
from the current 5.65 and 7.65.

---

## 2. Regulatory constants: sourced, not chosen

These are transcribed from the regulation. If any is wrong, the engine is wrong.

| Constant | Value | Citation |
| --- | --- | --- |
| Health warning text | The canonical statement, verbatim | 27 CFR 16.21 |
| Prefix capitalization | `GOVERNMENT WARNING:` in capitals | 27 CFR 16.22(a) |
| Prefix weight | Bold | 27 CFR 16.22(a) |
| Remainder weight | Not bold | 27 CFR 16.22(a) |
| Type size, 237 mL or less | 1 mm minimum | 27 CFR 16.22(b) |
| Type size, over 237 mL to 3 L | 2 mm minimum | 27 CFR 16.22(b) |
| Type size, over 3 L | 3 mm minimum | 27 CFR 16.22(b) |
| Wine ABV tolerance, 14% or below | plus or minus 1.5 points | 27 CFR 4.36(b)(1) |
| Wine ABV tolerance, above 14% | plus or minus 1.0 points | 27 CFR 4.36(b)(1) |
| Wine tax class boundary | 14%, not bridgeable by tolerance | 27 CFR 4.36(b)(2) |
| Distilled spirits ABV tolerance | plus or minus 0.3 points | 27 CFR 5.65(a)(2) |
| Malt beverage ABV tolerance | plus or minus 0.3 points | 27 CFR 7.65(b)(2) |
| Malt tolerance floor | none below 0.5% ABV | 27 CFR 7.65(b)(2) |

Three of these changed the design after the fact, which is the argument for
looking them up rather than working from memory:

- **Bold is two separate requirements.** The opening words must be bold and the
  remainder must not be. The extraction contract tracks `prefix_is_bold` and
  `remainder_is_bold` separately as a result, rather than carrying one flag for
  the block.
- **Type size depends on the container, not the label.** The warning check
  therefore takes the parsed net contents. A 1 mm warning is a finding on a
  750 mL bottle and fully compliant on a 50 mL miniature.
- **The wine tolerance cannot bridge 14%.** 13.9% against 14.1% is a 0.2 point
  gap inside a 1.5 point band, and it is still a hard mismatch, because the two
  values fall in different taxable grades.

---

## 3. The central interpretation: what a tolerance means here

**This is the most consequential assumption in the engine, and it is a
judgement, not a citation.**

As written, every ABV tolerance in section 2 bounds the difference between the
alcohol content *stated on the label* and the alcohol content *actually in the
bottle*. It is a manufacturing and laboratory allowance.

This engine compares a different pair: the value on the *application form*
against the value on the *label*. Both are paperwork. Strictly, the regulation
has nothing to say about that comparison, and any difference between the two
documents is a discrepancy.

Applying the bands as a straight pass or fail would therefore be a misuse of
them. Ignoring them entirely would throw away the only principled scale
available for how far apart two alcohol figures can be. The engine splits the
difference and uses them as a severity boundary:

| Difference | Verdict | Reading |
| --- | --- | --- |
| Exactly zero | `match` | The documents agree. |
| Within the band | `needs review` | The documents disagree, but the label would still be lawful for this product. Worth an agent's eye, not a violation. |
| Beyond the band | `mismatch` | The documents disagree by more than the regulation would forgive under any reading. |

Only exact agreement passes clean. The reasoning is repeated at the top of
`app/matching/quantities.py` so it is not discoverable only from this document.

**If this is judged wrong, the fix is small.** Collapsing `needs review` into
`mismatch` makes any difference a hard failure and is a one-line change in
`compare_alcohol_content_field`.

---

## 4. Engineering choices awaiting calibration

None of these come from a regulation. They are starting values chosen to be
defensible, and phase 8 is where the fixture set gets to argue with them.

| Choice | Value | Why this value | How to validate |
| --- | --- | --- | --- |
| Low-confidence threshold | 0.75 | Below this an extraction is not trusted to clear a field alone. Chosen as a round value; no evidence yet. Applies to the government warning as well as the ordinary fields, since the warning is the last one that should clear on a doubtful reading. | Compare against the confidence distribution `gpt-4.1-mini` actually returns on the phase 3 fixtures. It may well cluster far above 0.75, making the gate inert. |
| Brand name fuzzy tier | 0.85 | Wide enough for a transcription slip, narrow enough that a different product falls through to mismatch. | Count false `needs review` on the 20 clean fixtures. |
| Class or type fuzzy tier | 0.85 | Same reasoning as brand name. | As above. |
| Bottler address fuzzy tier | 0.70 | Deliberately wide. Addresses vary harmlessly in form far more than brand names do, and approach.md section 5.3 asks for a bias toward review. | Watch for a genuinely different address scoring above 0.70. |
| Net contents rounding slack | 0.5% relative | Absorbs unit-system rounding only. 750 mL is 25.36 fl oz, and a label printing 25.4 is the same declaration, not a different one. | Confirm no fixture pair inside 0.5% is a real difference. |
| Proof consistency slack | 0.1 points | Proof is twice ABV by definition. The slack absorbs a label that rounds one of the two figures. | Should need no tuning. |
| Default type size band | 2 mm | Used when container volume cannot be parsed. Covers the standard bottle range, which is the likeliest case. | Rare in practice; the label states net contents. |

The confidence threshold is the one most likely to be wrong. Models are
routinely overconfident, and a self-reported confidence is a weaker signal than
its presence in a schema suggests.

---

## 5. Smaller interpretation decisions

**Warning wording is compared case-insensitively.** Capitalization is checked
separately and immediately afterwards. Comparing case-sensitively would make a
title-case warning report as a dozen wording changes rather than as the single
capitalization failure it is, and the agent would have to work out which of the
two problems is real. The order of checks in architecture.md section 4 already
implies this; the implementation makes it explicit.

**Country of origin is omitted, not marked inapplicable.** On a domestic
product the field does not appear in the results at all. The alternative was a
fourth verdict state, which would weaken the three-state promise in ADR-003 for
one conditional field. The interface in phase 6 renders whatever fields it is
given, so an absent field costs nothing there.

**A missing required field is a mismatch; a field the application leaves blank
is needs review.** The label failing to carry something the application claims
is a substantive problem. The application failing to state something the label
carries is an incomplete submission, which is a different kind of problem and
not one the label is guilty of.

**Proof and ABV disagreeing is a label defect on its own.** If a label states
45% and 80 proof, it contradicts itself regardless of what the application says,
so it is a mismatch before the application is consulted at all.

**Unreadable returns no field verdicts whatsoever.** Not low-confidence
verdicts, not partial results. Approach.md section 5.4 makes this a distinct
outcome, and returning fields extracted from an image nobody could read would
present a guess as evidence.

**A compound net contents declaration is summed; a restatement is not.** US
labels write 709 mL as `1 PINT 8 FL. OZ.`, two units naming one volume, while
`750 mL (25.4 fl oz)` names one volume twice. They are told apart by shape
rather than by unit system: a parenthesized quantity is always a restatement,
and outside parentheses the parts of a compound descend in size and never repeat
a unit. Reading only the first quantity, which is what the engine did first,
turned a compliant `1 PINT 8 FL. OZ.` label into a 33% net contents mismatch.

**`St` is resolved by position, not by table.** It abbreviates Street in
`120 Main St` and Saint in `St. Louis`, so the expansion looks at what follows:
a plain word after it means Saint, and ending the address line means Street.
Directional abbreviations get a related rule, expanding only inside a segment
that begins with a house number, so the `E` in `E & J Gallo` stays a name.
Neither rule is airtight, and both are recorded in section 8.

---

## 6. Dependency choice

**`difflib` from the standard library, not `rapidfuzz`.** One library serves
both needs: `SequenceMatcher.ratio()` for the fuzzy tier and `get_opcodes()` for
the word-level warning diff. `rapidfuzz` is faster and ships a better
`token_sort_ratio`, but at roughly seven fields across thirty-five fixtures the
speed difference is unmeasurable, and token sorting is a three-line helper. The
engine adds no dependency to `pyproject.toml` as a result.

If extraction quality later demands better fuzzy scoring, `rapidfuzz` is a drop
-in for `_similarity` in `comparators.py` and nothing else changes.

---

## 7. Scope boundaries held in phase 2

Recorded because each was a live temptation while building.

- The mock `LabelReader` serves readings handed to it by the caller. It does
  not carry a fixture corpus. Phase 3 built the corpus but deliberately did not
  wire it into the reader; a fixture-backed reader arrives in phase 4 alongside
  the OpenAI one.
- The abbreviation and synonym tables in `normalize.py` are starter sets, not
  attempts at completeness. They will grow against real fixture failures rather
  than by imagination.
- No route, no prompt, no OpenAI client. The engine imports nothing capable of
  a network call, which is asserted by a test rather than assumed.
- Latency is not measured here. The engine runs in well under a millisecond and
  is not part of the latency risk; phase 4 instruments the path that is.

---

## 8. Known gaps carried forward

Updated after phase 3. The fixture corpus is described in
[fixtures.md](./fixtures.md); its section 8 carries the same table from the
corpus side.

| Gap | Consequence | Status |
| --- | --- | --- |
| Every threshold in section 4 is unvalidated | Accuracy claims are not yet evidence | **Open.** Phase 8. The corpus is now the input to that measurement. |
| Type size in millimetres is estimated from a photograph | Inherently unreliable, which is why it grades soft per ADR-005 | **Now measurable.** Fixtures are rendered at an exact cap height, so phase 4 compares the model's estimate against a known value rather than against an opinion. |
| Bold detection has the same weakness | Same soft grading | **Now measurable.** Same reason: the prefix is drawn with the bold face or it is not, and `warning-not-bold` and `warning-remainder-bold` cover both halves of 27 CFR 16.22(a). |
| CFR values read from a mirror, not eCFR | Small risk of a stale value | **Open.** One manual eCFR pass before submission. |
| `beverage_class` defaults to distilled spirits | A record that omits it silently gets the 0.3 point band | **Closed.** Every seed record sets it explicitly, and `test_every_record_sets_its_beverage_class_explicitly` fails the build if one stops. |
| The `St` position rule is a heuristic | `120 St James St` reads the first `St` as Saint, which is right, but a street named only `St James` with no suffix would read as Saint too | **Closed for the covered senses.** `address-saint-and-street` carries `1 St James St, St. Louis, MO` against the spelled-out form and matches. |
| Directionals expand only in a numbered street line | `North Main St, Louisville` with no house number keeps `N` unexpanded on one side if the other spells it out | **Open, and now pinned.** `address-directional` is exactly this case. The engine returns `needs review` where `match` would be ideal. Recorded rather than fixed, because failing toward a human is defensible; see fixtures.md section 8. |
| Compound volumes are detected by descending size | A label writing the smaller part first would not be summed | **Covered in the passing direction** by `net-contents-compound` and `net-contents-restated`. A label writing the smaller part first still has no fixture. |
