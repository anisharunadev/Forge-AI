# packages/forge-pi — Product Intelligence

Powers **Rule 10** features: codebase scanning, knowledge graph construction,
idea scoring, customer-voice clustering, market-signal processing, PRD
generation, architecture-diagram auto-gen, and API-contract discovery.

If a UI feature claims to ingest a codebase, score an idea, or build a
knowledge graph, it MUST delegate to `forge-pi`. Never reimplement these
in `apps/forge`.

**Layout:** `agents/` · `skills/` · `capabilities/` · `commands/` ·
`forge-pi.catalog.json` (registry the UI reads).