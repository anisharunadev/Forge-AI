"""Documentation Agent — Stage 7 of the FORA SDLC pipeline.

See `agents/documentation/prompt.md` for the system prompt and
`agents/documentation/README.md` for the agent-level overview.

Public contract (FORA-117 / 7.1.6 — doc storage & knowledge layer):

- `schemas.DocIndexEntry`     — one row of the doc index
- `schemas.AdrRegistryEntry`  — one row of the ADR registry
- `schemas.DocIndex`          — the full on-disk doc index
- `schemas.AdrRegistry`       — the full on-disk ADR registry
- `schemas.FreshnessSla`      — per-kind freshness contract
- `schemas.FreshnessWarning`  — emitted by `docs.freshness_check`
- `docs_query`                — `docs.list`, `adr.list`, `docs.freshness_check`
"""
