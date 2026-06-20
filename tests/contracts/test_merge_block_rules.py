"""
Validator for the MergeBlockRuleSet contract (FORA-495 / Phase 3 §D).

The contract lives at `packages/contracts/src/merge_block_rules.schema.json`
(JSON Schema draft 2020-12).  The worked example at
`packages/contracts/examples/merge_block_rules.example.json` must validate
against it and must enumerate every default rule plus the pinned
convention.no_autonomous_clears rule.

This test is the gate that a contract change cannot land unless the
worked example still validates.  A drift between the two is a bug in
the schema, per FORA-394 §7 invariant 1 ("the contract is the
product").

Run: `python3 -m pytest tests/contracts/test_merge_block_rules.py`
"""

from __future__ import annotations

import json
import os
import sys

import jsonschema  # type: ignore


HERE = os.path.dirname(os.path.abspath(__file__))
# tests/contracts/test_merge_block_rules.py → repo root is two dirs up
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, REPO_ROOT)

SCHEMA_PATH = os.path.join(
    REPO_ROOT,
    "packages",
    "contracts",
    "src",
    "merge_block_rules.schema.json",
)
EXAMPLE_PATH = os.path.join(
    REPO_ROOT,
    "packages",
    "contracts",
    "examples",
    "merge_block_rules.example.json",
)


# The 9 default rules from FORA-394 §5.2 plus the pinned synthetic rule
# (convention.no_autonomous_clears) added per the FORA-495 charter.
EXPECTED_RULE_IDS = {
    "qa.test.verdict.fail",
    "qa.tier.not_implemented.critical_path",
    "security.finding.high",
    "security.finding.critical",
    "compliance.gap.high",
    "convention.branch_protection",
    "dependency.high_cve",
    "secrets.detected",
    "coverage.regression",
    "convention.no_autonomous_clears",
}


def _load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fp:
        return json.load(fp)


def _validator() -> jsonschema.Draft202012Validator:
    schema = _load(SCHEMA_PATH)
    return jsonschema.Draft202012Validator(schema)


def _wrap_rule_in_envelope(rule: dict) -> dict:
    """Wrap a single rule dict in a valid MergeBlockRuleSet envelope so
    we can use the top-level validator (which has the $defs in scope)."""
    return {
        "contractId": "agents.devops.merge_block_rules",
        "contractVersion": "1.0.0",
        "issuedAt": "2026-06-20T05:30:00.000Z",
        "rules": [rule],
    }


# -- AC: schema + example files exist ---------------------------------------

def test_schema_file_exists() -> None:
    assert os.path.isfile(SCHEMA_PATH), f"missing {SCHEMA_PATH}"


def test_example_file_exists() -> None:
    assert os.path.isfile(EXAMPLE_PATH), f"missing {EXAMPLE_PATH}"


# -- AC: schema is well-formed draft 2020-12 --------------------------------

def test_schema_meta_is_draft_2020_12() -> None:
    schema = _load(SCHEMA_PATH)
    assert schema.get("$schema") == "https://json-schema.org/draft/2020-12/schema"


def test_schema_compiles_under_draft_2020_12() -> None:
    # Just constructing the validator exercises metaschema + refs.
    v = _validator()
    assert v.schema["title"] == "FORA MergeBlockRuleSet"


# -- AC: the worked example validates against the schema --------------------

def test_example_validates_against_schema() -> None:
    schema = _load(SCHEMA_PATH)
    example = _load(EXAMPLE_PATH)
    jsonschema.validate(example, schema)


# -- AC: example lists every default rule + the pinned rule -----------------

def test_example_lists_all_expected_rules() -> None:
    example = _load(EXAMPLE_PATH)
    rule_ids = {r["ruleId"] for r in example["rules"]}
    missing = EXPECTED_RULE_IDS - rule_ids
    extra = rule_ids - EXPECTED_RULE_IDS
    assert not missing, f"missing rules in example: {sorted(missing)}"
    assert not extra, f"unexpected rules in example: {sorted(extra)}"


def test_example_contract_id_and_version() -> None:
    example = _load(EXAMPLE_PATH)
    assert example["contractId"] == "agents.devops.merge_block_rules"
    # v1.0.0 for the initial release per the FORA-495 charter
    assert example["contractVersion"].startswith("1.")


# -- AC: no autonomous clears is pinned --------------------------------------

def test_no_autonomous_clears_rule_is_pinned() -> None:
    example = _load(EXAMPLE_PATH)
    pin = next(
        r for r in example["rules"] if r["ruleId"] == "convention.no_autonomous_clears"
    )
    assert pin["blocks"] is True, "no_autonomous_clears must block"
    # The pinned rule must require a board approval to relax.
    assert pin["escalation"] == ["board"]
    assert pin["metadata"].get("pinned") is True


# -- AC: every blocking rule escalates to at least one role ----------------

def test_every_blocking_rule_has_an_escalation() -> None:
    schema = _load(SCHEMA_PATH)
    example = _load(EXAMPLE_PATH)
    v = _validator()
    for rule in example["rules"]:
        if rule.get("blocks"):
            assert rule.get("escalation"), (
                f"blocking rule {rule['ruleId']!r} must carry an escalation list"
            )
            # Schema's allOf constraint enforces the same thing; wrap
            # the rule in a valid envelope and validate the rule via
            # a JSONPath-style eval against the schema. We use the
            # validator's iter_errors to confirm the rule passes the
            # MergeBlockRule subschema by checking no error path points
            # at this rule.
            errors = list(v.iter_errors(_wrap_rule_in_envelope(rule)))
            relevant = [e for e in errors if e.absolute_path and "rules" in str(e.absolute_path)]
            assert not relevant, (
                f"rule {rule['ruleId']!r} failed MergeBlockRule validation: "
                f"{[e.message for e in relevant]}"
            )


# -- AC: convention.branch_protection references FORA-245 ------------------

def test_branch_protection_rule_points_at_fora_245() -> None:
    example = _load(EXAMPLE_PATH)
    rule = next(
        r for r in example["rules"] if r["ruleId"] == "convention.branch_protection"
    )
    # FORA-245 ships BranchProtectionPolicy (Option B); the rule set
    # must reference it explicitly so future readers know the source of
    # truth.
    assert "externalPolicyRef" in rule
    assert "BranchProtectionPolicy" in rule["externalPolicyRef"]


# -- AC: coverage.regression is warn-only ----------------------------------

def test_coverage_regression_is_warn_only() -> None:
    example = _load(EXAMPLE_PATH)
    rule = next(
        r for r in example["rules"] if r["ruleId"] == "coverage.regression"
    )
    assert rule["blocks"] is False
    assert rule.get("warnOnly") is True


# -- AC: secrets.detected is sticky (slaHours=0) ---------------------------

def test_secrets_detected_is_sticky() -> None:
    example = _load(EXAMPLE_PATH)
    rule = next(r for r in example["rules"] if r["ruleId"] == "secrets.detected")
    assert rule["slaHours"] == 0


# -- AC: negative-path — a rule that escalates to `board` plus another role
# is rejected by the schema.

def test_board_escalation_must_be_exclusive() -> None:
    schema = _load(SCHEMA_PATH)
    bad_rule = {
        "ruleId": "qa.test.bad",
        "description": "Invalid: board must be exclusive.",
        "severity": "high",
        "source": "testReport",
        "predicate": {"kind": "equals", "expression": "$.verdict", "value": "fail"},
        "blocks": True,
        "escalation": ["board", "cto"],
        "slaHours": 4,
        "auditEventType": "artifact.rejected.merge",
    }
    v = jsonschema.Draft202012Validator(schema)
    assert v.is_valid(_wrap_rule_in_envelope(bad_rule)) is False, (
        "rule with board + extra role should be rejected"
    )


def test_warn_only_rule_cannot_block() -> None:
    schema = _load(SCHEMA_PATH)
    bad_rule = {
        "ruleId": "qa.test.bad",
        "description": "Invalid: warnOnly=true requires blocks=false.",
        "severity": "low",
        "source": "testReport",
        "predicate": {"kind": "equals", "expression": "$.verdict", "value": "fail"},
        "blocks": True,
        "warnOnly": True,
        "escalation": ["qa_lead"],
        "slaHours": 4,
        "auditEventType": "artifact.rejected.merge",
    }
    v = jsonschema.Draft202012Validator(schema)
    assert v.is_valid(_wrap_rule_in_envelope(bad_rule)) is False