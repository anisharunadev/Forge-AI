# Code Analyzer (FORA-82, sub-goal 8.1)

Pure-Python, deterministic code analyzer that turns a normalized
`RepoScope` into a `MigrationScope` — the typed deliverable the
downstream sub-goals (8.2 dependency graph, 8.3 AWS Transform
orchestration, 8.4 migration planner) consume.

## Quick start

```python
from agents.refactor import analyze_scope, sample_legacy_monolith

scope = sample_legacy_monolith()             # the canonical v0.1 fixture
report = analyze_scope(scope)

print(report.summary.transform_tier)          # dominant tier
print(report.summary.estimated_effort_days)   # total person-days
for r in report.top_risks(5):                 # top-N risk files
    print(r.path, r.risk_level, r.score)
```

## What it does

- **Categorizer** (`categorizer.py`) — assigns every file a
  migration category: `keep_as_is`, `refactor_in_place`, `replace`,
  `rewrite`, or `remove`. Rules are transparent and order-stable.
- **Risk scorer** (`risk_scorer.py`) — assigns every file a risk
  level (`low` / `medium` / `high`) on a clamped [0, 10] scale
  using a weighted sum of fan-in, fan-out, LoC, role, test
  coverage, and entrypoint status. Also estimates per-file
  person-day effort.
- **Transform mapper** (`transform_mapper.py`) — assigns every
  file an AWS Transform unit (`lambda`, `container`, `ec2`,
  `aurora`, `api_gateway`, `step_functions`, `s3`, `cloudfront`,
  `skip`) and tier (`T1`–`T4` + `skip`) using closed-set
  rules so 8.3 can diff and orchestrate.

The output `MigrationScope` carries:

- a one-row `summary` (file count, LoC, languages, services,
  dominant tier, dominant risk, total effort);
- a `categorizations` list, one verdict per file, each with
  rationale + evidence;
- a `transform_mappings` list with AWS unit + tier per file;
- a `risk_assessments` list with score, factors, and effort
  estimate per file;
- top-level `evidence` rows so 8.2/8.3/8.4 can attribute cost /
  choice back to a specific stage.

## Hard rules

- No LLM, no network, no subprocess. Pure function of the input.
- Deterministic. Two runs of `analyze_scope` on the same
  `RepoScope` produce byte-identical `MigrationScope` (modulo
  `analyzer_runtime_ms` and `report_id`).
- Cost bound: < 10 s and $0 per run (asserted by the smoke
  test).

## Acceptance contract (AC)

1. Consumes a `RepoScope` (a normalized projection of a GitHub
   repo; v0.1 uses a mock fixture, v0.2 wires the GitHub MCP).
2. Emits a `MigrationScope` with categorizations, transform
   mappings, and risk assessments for every file.
3. Deterministic: two consecutive runs produce identical output
   modulo run-time fields.
4. Every file carries a category + risk + transform mapping.
5. Cost bound: < 10 s and $0 per run.
6. Output is written to:
   - `forge/8.1/migration-scope.json` (the canonical deliverable)
   - `forge/8.1/risk-register.md` (the human-readable risk register)
   - `forge/8.1/transform-mapping.json` (the AWS Transform unit map)
   - `agents/refactor/evidence/smoke_<ts>/result.json`

## Smoke test

```bash
python -m agents.refactor.smoke_test
```

The smoke test runs `analyze_scope` on `sample_legacy_monolith()`
twice (determinism), asserts all 6 ACs, and writes the deliverable
artefacts. Exits non-zero on any failure.
