# FORA — Org chart (agent roster + charter index)

**Owner:** CTO (operational); KnowledgeSteward (Knowledge Layer maintenance)
**Status:** v0.1 — filed 2026-06-18 via [FORA-295](/FORA/issues/FORA-295)
**Stage injection:** Inject into **CTO**, **CEO**, and any sub-agent boot that needs to know who owns what.

---

## 0. Quick start

- **This file is the index. Each charter is the contract.** A future sub-agent woken cold with only this file in context can find the named owner of any domain by following the link in the table.
- **Every agent has exactly one entry.** If a box exists in [memory/architecture.md §1](./architecture.md#1-the-shape-we-are-building), it exists here.
- **One chart, one ground truth.** The agent-of-agents diagram in [memory/architecture.md §1](./architecture.md#1-the-shape-we-are-building) is the runtime topology; this file is the roster behind it.

## 1. Agent roster (current)

| Agent id | Name | Role | Charter | Owner | Reports to |
| --- | --- | --- | --- | --- | --- |
| `f1fa3cb8-7ac6-4f08-a0fa-c8bbb72c22ae` | CEO | ceo | — | — | — |
| `f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0` | CTO | cto | — (role definition in `instructions/AGENTS.md`) | self | CEO |
| `588b21bb-752f-47d7-b7b4-b7eec0828d71` | KnowledgeSteward | engineer | [charter](../../agents/knowledge-steward/charter.md) (mirrored pattern via [FORA-151](/FORA/issues/FORA-151)) | self | CTO |
| `c4654678-cb35-4d12-abd5-0b9b2a644975` | **Architect** (Sync Plane Architect) | engineer | [**charter**](../../agents/architect/charter.md) + [30/60/90](../../agents/architect/30-60-90.md) — filed 2026-06-18 via [FORA-295](/FORA/issues/FORA-295) | self | CTO (operational) / CEO (Architect role) |
| `27431e10-478f-45da-a058-92770d404b53` | SeniorEngineer | engineer | — (HIRING_PLAN §2 row 2) | self | CTO |
| `421b534e-9872-4b80-a701-74711dea7da7` | DocAgent | engineer | [runbook](../../docs/agents/artifact-generator.md) (FORA-117) | self | CTO |
| `127b8152-ff15-422f-adcd-805445fb9fd7` | arch-analyzer | engineer | (per [FORA-29](/FORA/issues/FORA-29)) | self | CTO |
| `606a5289-dfea-4d47-9057-369d3fe10ee9` | ArtifactGenerator | engineer | [runbook](../../docs/agents/artifact-generator.md) | self | CTO |
| `791ddded-cf38-4c77-a3e6-0690059f9ad0` | IntegrationEngineer | engineer | — (planned) | self | CTO |
| `231cc5ae-3235-482c-a791-d8ff3e217c8e` | SecurityEngineer | engineer | — (HIRING_PLAN §2 row 5) | self | CTO |
| `040a8e3b-0b6d-44a3-a122-09f61f838d96` | Epic Generator | pm | — (per Epic Generator runbook) | self | CEO |
| `99b34c5d-87d4-42a0-a66a-c65a916aeeec` | BA | pm | — (HIRING_PLAN §2 row 3, BA-Agent #3) | self | CEO |
| `920e1d84-d87d-4091-936a-f77a6f264a1b` | Research Agent | researcher | — | self | CTO |
| `7d5f04ed-48db-4ce9-beff-933e37426c66` | Jira Sync Agent | pm | — | self | CTO |
| `fc897e4f-e7a3-4025-b843-e7628ad902b0` | ScrumMaster | pm | — | self | CEO |

## 2. Reporting topology

```
CEO (f1fa3cb8)
├── CTO (f4d4bf77)
│   ├── Architect (c4654678) — Sync Plane design + Epic 11 ownership
│   │   └── SEE: [charter](../../agents/architect/charter.md)
│   ├── SeniorEngineer (27431e10) — runtime + MCP integrations
│   ├── DocAgent (421b534e) — Knowledge Layer docs pipeline
│   ├── SecurityEngineer (231cc5ae) — security review (planned)
│   ├── IntegrationEngineer (791ddded) — planned
│   ├── Research Agent (920e1d84)
│   ├── Jira Sync Agent (7d5f04ed)
│   ├── KnowledgeSteward (588b21bb) — Knowledge Layer maintenance
│   ├── arch-analyzer (127b8152) — arch-style-detector
│   └── ArtifactGenerator (606a5289) — release-train artefacts
├── Epic Generator (040a8e3b) — Board-driven Epic drafting
├── BA (99b34c5d) — BA-Agent #3
└── ScrumMaster (fc897e4f) — coordination + blocker unblock
```

The agent-of-agents diagram (the runtime topology) lives in [memory/architecture.md §1](./architecture.md#1-the-shape-we-are-building). This file is the named roster behind that diagram.

## 3. How to use this file

1. **A new agent is hired.** The KnowledgeSteward adds a row to §1 and a box to §2 with the charter link.
2. **An agent charter is filed.** The KnowledgeSteward adds or updates the **Charter** column for that agent row.
3. **An agent is released.** The row is removed from §1 and §2; charter files move under `agents/<name>/archived-<date>/`.
4. **A reporting line changes.** The CTO PATCHes §2 with a comment citing the issue that authorised the change (per CEO or Board decision).

## 4. Related

- The agent-of-agents runtime topology: [memory/architecture.md §1](./architecture.md#1-the-shape-we-are-building)
- The architect charter cross-linked from §1 row 5: [agents/architect/charter.md](../../agents/architect/charter.md)
- The architect 30/60/90 plan template: [agents/architect/30-60-90.md](../../agents/architect/30-60-90.md)
- The CTO coordination child for the architect day-by-day plan: [FORA-294](/FORA/issues/FORA-294)
- The CEO decision that activated the architect role: [FORA-279](/FORA/issues/FORA-279) (comment `8e866ad2-…`)
- The KnowledgeSteward charter filing: [FORA-151](/FORA/issues/FORA-151)
- HIRING_PLAN §2 (founding-team sequencing), §4 (org shape at scale), §7 (interview loop), §9 (first-90-days).

---

**Versioning:** a new agent entry is a minor bump. A removal is a patch (the charter is archived). A reporting-line change in §2 is a minor bump and requires the CTO to cite the authorising issue. The KnowledgeSteward authors routine updates; the CTO co-signs every §2 change.