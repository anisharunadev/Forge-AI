# Self-Healing Agent v1 (FORA-37)

Goal 4.2 of the FORA SDLC. Detects selector drift in recorded test
traces and proposes repairs. v1 ships as **scaffold + dry-run only**;
the actual apply-and-re-run loop is **Phase 4** and is feature-flagged
off.

> **v1 invariant:** no code path in this module mutates a test file.
> The dry-run reads a trace, emits a `RepairProposal`, and stops. The
> apply path is a stub that raises `NotImplementedError` if it is
> ever called.

## What v1 ships

| Deliverable | Path | Status |
|---|---|---|
| Wire-format contract (dataclass) | `schemas.py` | frozen at `0.1.0` |
| JSON schema for the wire format | `schemas/repair_proposal.schema.json` | published, jsonschema-validated |
| Deterministic rule-based dry-run | `dry_run.py` | no LLM, no network |
| Checked-in Playwright trace fixture | `fixtures/trace.json` | one fixture, three drift kinds + one timeout |
| Apply path stub | `dry_run.py::apply_repair` | raises unless feature flag is on |
| Feature flag | `feature_flag.py` | disabled in v1, no env override |
| Smoke test | `smoke_test.py` | 12 checks, all pass |
| Evidence | `evidence/repair_proposal.json` + `smoke_summary.json` | written by the smoke test |

## What Phase 4 (NOT in this batch) will add

- Read real Playwright / Cypress trace files from CI history
- LLM-backed selector proposals (or a hand-curated mapping table)
- Apply: write the proposed selector back into the test file
- Re-run the affected suite; **fail loud if coverage drops**
- Promote `timeout` from "notes only" to a real `DriftKind`

## Layout

```
agents/qa/self_healing/
  __init__.py                # public surface
  schemas.py                 # RepairProposal / DetectedDrift / ValidationRunId + validate()
  dry_run.py                 # run_dry_run(trace_path) -> RepairProposal
  feature_flag.py            # is_enabled() / mode() / flag_payload()
  fixtures/
    trace.json               # hand-written Playwright trace for the smoke test
  schemas/
    repair_proposal.schema.json   # wire-format JSON schema (jsonschema Draft 2020-12)
  evidence/                  # written by the smoke test
    repair_proposal.json
    smoke_summary.json
  smoke_test.py              # 12 acceptance checks
  README.md                  # this file
```

## Public surface

```python
from agents.qa.self_healing import (
    run_dry_run, apply_repair,
    RepairProposal, DetectedDrift, ProposedRepair, ValidationRunId,
    DriftKind, RepairKind,
    feature_flag,
    CONTRACT_VERSION,
)

proposal = run_dry_run("agents/qa/self_healing/fixtures/trace.json")
# proposal.mode == "dry_run"
# proposal.feature_flag == {"self_healing": "v1_dry_run", "enabled": False}
# proposal.detected_drift is non-empty for the smoke fixture
# proposal.repair_proposal may be smaller than detected_drift:
#   SELECTOR_MISSING drifts are kept in detected_drift but suppressed
#   from repair_proposal because the trace alone cannot suggest a new
#   selector. Phase 4 will fill that in.
```

## Wire format (v0.1.0)

```jsonc
{
  "schema_version": "0.1.0",
  "proposal_id": "prop-<sha16>",            // stable for (trace_sha, source_test_run_id)
  "validation_run_id": "vrn-<sha16>",       // join key into the originating test run
  "trace_sha": "<sha256 hex of the trace>",
  "source_test_run_id": "<playwright run id | allure uuid | ci run number>",
  "detected_drift": [
    {
      "drift_id": "drift-<sha16>",
      "kind": "selector_missing" | "selector_ambiguous" | "attribute_value_changed",
      "original_selector": "button#submit-order",
      "observed": "no element found for 'button#submit-order'",
      "confidence": 0.85,                   // rule-based, in [0.0, 1.0]
      "test_file": "tests/checkout.spec.ts",
      "test_name": "should complete checkout",
      "page_url": "https://example.com/checkout",
      "action_index": 1
    }
  ],
  "repair_proposal": [
    {
      "repair_id": "repair-<sha16>",
      "drift_id": "drift-...",
      "kind": "propose_new_selector",
      "proposed_selector": "a.continue >> nth=0",
      "rationale": "trace shows multiple matches; selector needs to be disambiguated",
      "confidence": 0.9
    }
  ],
  "mode": "dry_run",                        // v1 invariant
  "feature_flag": { "self_healing": "v1_dry_run", "enabled": false },
  "produced_at": "<ISO 8601 UTC>",
  "notes": "optional free text"
}
```

## Rule-based detection (v1)

| `result` in the trace | `DriftKind` emitted | `proposed_selector` |
|---|---|---|
| `no_element` | `SELECTOR_MISSING` | (suppressed; no proposal in v1) |
| `multiple` | `SELECTOR_AMBIGUOUS` | `<selector> >> nth=0` (placeholder) |
| `wrong_value` | `ATTRIBUTE_VALUE_CHANGED` | `text="<observed>"` |
| `timeout` | none in v1; recorded in `notes` | (Phase 4 may promote) |
| `ok` | none | (no drift) |

`confidence` is rule-based, in `[0.0, 1.0]`, and **never calls an LLM**.

## Running the smoke test

```bash
python3 -m agents.qa.self_healing.smoke_test
```

Expected output:

```
SMOKE TEST PASSED
  evidence_path: agents/qa/self_healing/evidence/repair_proposal.json
  summary_path:  agents/qa/self_healing/evidence/smoke_summary.json
  drifts detected: 3
  repairs proposed: 2
```

The smoke test enforces 12 checks:

1. `feature_flag.is_enabled()` is `False` and `mode()` is `"v1_dry_run"`.
2. The proposal's `mode` is `"dry_run"`.
3. The dataclass `RepairProposal.validate()` returns `[]`.
4. The JSON payload validates against `schemas/repair_proposal.schema.json` (jsonschema).
5. The payload's `feature_flag` block reports `enabled=false, self_healing=v1_dry_run`.
6. The dry-run emits the three expected drift kinds.
7. Every `ProposedRepair` validates cleanly.
8. The `proposal_id` is stable across re-runs (idempotency).
9. The `fixtures/` and `schemas/` directories are byte-identical before and after the run.
10. `apply_repair()` raises `NotImplementedError` in v1.
11. The evidence file is written and the summary is recorded.
12. The exit code is `0`.

`--check-evidence-only` re-validates an existing evidence file without re-running the dry-run.

## Phase 4 flip runbook

When the Phase 4 code path is ready to ship, follow this exact sequence. Do not skip steps; the review is the point.

1. **Land the apply path in `dry_run.py::apply_repair`** behind the existing `_SELF_HEALING_ENABLED` / `_SELF_HEALING_MODE` checks. The path must:
   - Take a `RepairProposal` and apply each `repair_proposal` entry to its `test_file`.
   - Re-run only the affected test file (or suite). Fail loud on coverage regression.
   - Emit an `applied` mode payload (new `mode` value; new `CONTRACT_VERSION` major bump).
2. **Bump `CONTRACT_VERSION`** in `schemas.py` from `0.1.0` to `1.0.0` and add a migration note in the version-comment block.
3. **Update `schemas/repair_proposal.schema.json`**:
   - Change `schema_version` `const` to `"1.0.0"`.
   - Add `"applied"` to the `mode` enum.
   - Add any new fields Phase 4 needs (e.g. `apply_diff`, `validation_run_after`) as optional.
4. **Flip the feature flag in `feature_flag.py`** — set both `_SELF_HEALING_ENABLED = True` and `_SELF_HEALING_MODE = "phase_4_apply"`. Do not add an env-var override in this commit; the friction is the point.
5. **Update the checked-in fixture** so it covers at least one of the new code paths (e.g. a `drift` that should produce a real `apply_diff`).
6. **Re-run the smoke test** and confirm all 12 checks still pass. The `apply_repair_refused_in_v1` check must be **updated** to assert the new applied-path behaviour (and ideally renamed to `apply_repair_round_trip`).
7. **Post a comment on FORA-37** with the diff range, the smoke-test output, the new evidence file's sha256, and the rationale for the flip. The CEO + the QA hire (when onboarded) must sign off before any production trace drives the apply path.
8. **Add a follow-up child issue** to the Epic 4 board for the "coverage regression" alert wiring (CI must fail the apply if post-apply coverage drops more than X%).

## Out of scope for v1 (deliberate)

- Reading real binary Playwright traces. v1 uses a hand-written JSON fixture; the Phase 4 implementation will need a real Playwright trace adapter.
- LLM calls. The v1 path is rule-based so the contract is testable. Phase 4 may introduce an LLM-backed proposer behind a `proposer_kind` discriminator; the wire format can carry that as an optional field under a major version bump.
- Cypress traces. v1 declares `framework` as `"playwright"` or `"cypress"` in the schema but only the Playwright shape is exercised by the fixture.
- Multi-page traces. v1 treats the trace as a flat list of actions; a future Phase 4 enhancement could group by `page_url`.
- Coverage regression detection. Phase 4 work, tied to a future QA hire.
