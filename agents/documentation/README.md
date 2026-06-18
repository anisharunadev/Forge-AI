# Documentation Agent ([FORA-81](/FORA/issues/FORA-81) / [FORA-118](/FORA/issues/FORA-118))

Stage 7 of the FORA SDLC pipeline. The **Doc Owner** role. See the [doc generation spec](/FORA/issues/FORA-81#document-doc-generation-spec) for the full contract.

## What it does

For every shipped change, the agent generates and maintains discoverable, current documentation. Every artifact carries a **freshness timestamp + source commit SHA** so the next reader can decide whether it is still valid.

Five generators ship under this agent:

- `readme` — `README.md`
- `api_docs` — OpenAPI / AsyncAPI / markdown
- `changelog` — `CHANGELOG.md` from conventional commits
- `release_notes` — per-release summaries
- `adr` — Architecture Decision Records

The agent also writes to the knowledge layer (`workspace/project/docs.md`, `workspace/project/adr-registry.md`) and emits a per-run audit record.

## Layout

```
agents/documentation/
  prompt.md          # system prompt — the spec's primary deliverable
  schemas.py         # DocGenInput / DocGenOutput / DocArtifact / DocGenError
  smoke_test.py      # sample run + 5 failure-mode tests + cost-ceiling + determinism
  README.md          # this file
  evidence/          # produced artifacts from the smoke test
```

Generator implementations and the storage contract are delivered by sibling sub-issues, all gated on the `doc-agent` hire per [FORA-142](/FORA/issues/FORA-142):

- [FORA-117](/FORA/issues/FORA-117) — 7.1.6 doc storage & knowledge-layer integration (first to ship)
- [FORA-119](/FORA/issues/FORA-119) — 7.1.3 API docs generator
- [FORA-120](/FORA/issues/FORA-120) — 7.1.2 README generator
- [FORA-121](/FORA/issues/FORA-121) — 7.1.5 ADR generator
- [FORA-122](/FORA/issues/FORA-122) — 7.1.4 Changelog & Release Notes generator

## Agent contract

See `prompt.md` for the full system prompt, model/cost policy, and tool permissions. The contract has four hard constraints:

1. **Determinism.** Same inputs → same output bytes.
2. **Source attribution.** Every artifact has `freshness_timestamp` + `source_sha`.
3. **Approval routing.** Routine updates auto-merge; new ADR / README rewrite / breaking notes require human approval.
4. **Idempotency.** Re-running with the same `input_sha` is a no-op.

## MCPs it calls

| Server | Tools used | Mode |
| --- | --- | --- |
| `github` | read repos/commits/files, write to `docs/`, `README.md`, `CHANGELOG.md` | live |
| `memory` | read+write `docs_index`, `adr_registry` | live |
| `audit` | write per-run record | live |

## Failure modes (must be detected and reported)

| Failure | Recovery |
| --- | --- |
| `MISSING_INPUT_SHA` | Abort. Operator must supply SHA. |
| `OVERSIZED_DIFF` | Chunk by file, run in series. |
| `AMBIGUOUS_CONVENTIONAL_COMMIT` | Surface as structured warning; do not invent a category. |
| `MODEL_TIMEOUT` | Switch to fallback model; emit `cost_record.fallback_used=true`. |
| `PARTIAL_KNOWLEDGE_LAYER_WRITE` | Re-run only the failed writes. |

## Smoke test

```bash
python -m agents.documentation.smoke_test
```

Exercises:

1. **Sample run** — stub generator on a small repo; output validates.
2. **All 5 failure modes** — see above.
3. **Cost ceiling** — pre-LLM-call refusal when input > ceiling.
4. **Determinism** — same input → same content_sha.

Writes evidence to `agents/documentation/evidence/smoke_<timestamp>.json`.

## Where this fits in the SDLC pipeline

```
[DevOps Stage 6] -> [Documentation Stage 7: this agent] -> [Release]
                                  |
                                  v
                  writes: README.md, CHANGELOG.md, docs/adr/
                  writes: workspace/project/docs.md, workspace/project/adr-registry.md
                  emits: Audit Agent run record
```

## Knowledge layer

The agent injects the following files from `workspace/` before each run:

- `workspace/project/PRD.md`
- `workspace/project/tech-stack.md`
- `workspace/project/docs.md` (current doc index — for diff/append)
- `workspace/customer/standards.md`
- `workspace/customer/conventions.md`

## Owner

CTO (interim) per [FORA-81](/FORA/issues/FORA-81) spec. Hands off to `doc-agent` once the [hire proposal (FORA-142)](/FORA/issues/FORA-142) is accepted and onboarded.
