# Architecture Style Detector (Forge AI-29, sub-goal 2.2)

Deterministic, in-memory detector that infers architecture styles from the
2.1 codebase graph (`codebase-graph.json`). Produces confidence-scored tags
for the 10 styles in the Forge AI-29 acceptance criteria plus a human-readable
rationale.

## Inputs

- `forge/2.2/input/codebase-graph.json` — the 2.1 graph artefact
  (schemaVersion 1, produced by `arch-analyzer/m1` per Forge AI-27).

## Outputs

- `forge/2.2/arch-style-tags.json` — canonical deliverable, the 10 tags
  with confidence + evidence + run meta.
- `forge/2.2/rationale.md` — human-readable summary, sorted by confidence.
- `agents/architecture/evidence/smoke_<UTC>/result.json` — run evidence
  (sha256 of input, AC checks, full report).

## Public surface

```python
from agents.architecture import detect_styles, render_rationale

graph = json.load(open("forge/2.2/input/codebase-graph.json"))
report = detect_styles(graph)         # pure, deterministic, < 10 s, $0
md = render_rationale(report)         # markdown
```

## Acceptance criteria coverage

| AC | Where it lives | Verified by |
|----|----------------|-------------|
| 1. Consumes the 2.1 graph artefact | `detector.detect_styles` → `schemas.GraphSummary.from_graph` | `smoke_test` step "loaded graph" |
| 2. Tags for the 10 styles | `scorers.SCORERS` registry (10 keys) + `ALL_STYLES` | `smoke_test` step "coverage" |
| 3. Evidence per tag | `scorers.Evidence` objects with `kind`, `description`, `paths`, `metric` | `smoke_test` step "evidence" |
| 4. Deterministic on same input | All scorers are pure; `GraphSummary` sorts every list; cross-adjustment deterministic | `smoke_test` step "determinism" |
| 5. < 10 s, no model spend | Pure-Python, ~3 ms warm on the Forge AI-27 graph; `cost_usd = 0.0` | `smoke_test` step "cost bound" |

## Scoring philosophy

Each scorer produces a `StyleTag` with:
- `confidence` ∈ [0, 1] (clamped weighted sum of positive/negative signals).
- `evidence[]` (positive, negative, neutral, cross-adjustment).
- `rationale` (one-sentence summary).

`detector._cross_adjust` resolves mutually-exclusive pairs:
- **monolith** vs **microservices** — if both score ≥ 0.4, dampen the lower.
- **modular-monolith** cap at 0.5 when **microservices** ≥ 0.5 (≥ 5 services
  is microservice-shaped, not classic modular monolith).

## Run the smoke test

```bash
# (one-time) copy the Forge AI-27 attachment into the workspace
cp /tmp/fora27/codebase-graph.json forge/2.2/input/codebase-graph.json

python3 -m agents.architecture.smoke_test
```

Expected output: `OK`, top tag = `microservices` (0.90), runtime < 10 s,
10/10 styles covered.

## Files

| File | Purpose |
|------|---------|
| `__init__.py`             | Re-exports the public API |
| `schemas.py`              | `GraphSummary`, `Evidence`, `StyleTag`, `ALL_STYLES` |
| `scorers.py`              | 10 pure-function style scorers + `SCORERS` registry |
| `detector.py`             | `detect_styles()` entry point + `StyleReport` |
| `rationale.py`            | `render_rationale()` markdown generator |
| `smoke_test.py`           | End-to-end AC verifier (5 checks) |
| `evidence/`               | Per-run smoke results |
