# kn-base — KnackForge Reference Seed

The `kn-base` package is the canonical KnackForge reference content
shipped to every new tenant via F-507 day-one bootstrap. It provides
the baseline standards, templates, governance policies, and tool
bundles that the platform depends on.

## Layout

```
kn-base/
  manifest.json           # JSON Schema 2020-12 manifest
  data/
    001_standards.json    # 8 KFG-STD-* standards
    002_templates.json    # 5 ADR / runbook / report / task-breakdown templates
    003_policies.json     # 4 governance policies
    004_tool_bundles.json # 6 tool bundles for governance
```

## Adding a new data file

1. Create `data/NNN_<table>.json` where `NNN` is the next 3-digit order prefix.
2. Wrap the rows in `{"rows": [...]}` — this is the runner's expected envelope.
3. Add an entry to `manifest.json` under `data_files` with the matching
   `file`, `table`, `order`, and `idempotency_key`.
4. Bump the manifest `version` (monotonic integer).
5. Update `row_counts_expected` to match the new totals.
6. Run the integrity suite: `pytest backend/tests/seeds/test_kn_base_integrity.py -v`.
