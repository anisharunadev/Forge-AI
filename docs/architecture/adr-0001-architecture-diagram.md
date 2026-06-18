# ADR-0001 — One-Page Architecture Diagram

**Source of truth.** If this file and [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md) §11 ever drift, **this file wins** — re-render the inline copy from here.

**Format.** Mermaid is the primary source. A pure-ASCII fallback follows the Mermaid block for renderers that do not understand Mermaid (Confluence, plain text review, email).

---

## 1. Mermaid (primary)

```mermaid
flowchart TB
  classDef user   fill:#f5f5f5,stroke:#333,color:#000
  classDef orch   fill:#dbeafe,stroke:#1d4ed8,color:#000
  classDef cross  fill:#fef3c7,stroke:#b45309,color:#000
  classDef team   fill:#dcfce7,stroke:#166534,color:#000
  classDef gate   fill:#fde2e4,stroke:#9f1239,color:#000

  U[User / PM<br/>feature / bug / modernization]:::user
  MO[Master Orchestrator<br/>Paperclip]:::orch
  SDLC[SDLC Agent<br/>sub-orchestrator]:::orch

  AGT_Cost[Cost]:::cross
  AGT_Audit[Audit]:::cross
  AGT_Eval[Evaluation]:::cross
  AGT_Mem[Memory]:::cross

  STG1[1. Ideation<br/>BA]:::team
  STG2[2. Architect<br/>Architect + Tech Lead]:::team
  STG3[3. Dev<br/>Developer + Reviewer]:::team
  STG4[4. QA<br/>QA Engineer]:::team
  STG5[5. Security<br/>Security Engineer]:::team
  STG6[6. DevOps<br/>DevOps + Cloud Architect]:::team
  STG7[7. Docs<br/>Docs Engineer]:::team

  G1[/Ideation gate — CEO/]:::gate
  G2[/Architect gate — CTO/]:::gate
  G3[/DevOps gate — CEO + CTO/]:::gate

  KL[(Knowledge Layer<br/>workspace/memory<br/>workspace/customer<br/>workspace/project)]:::orch

  U --> MO
  MO -- intent --> SDLC
  MO --> AGT_Cost
  MO --> AGT_Audit
  MO --> AGT_Eval
  MO --> AGT_Mem
  MO -. read .-> KL

  SDLC --> STG1 --> G1 --> STG2 --> G2 --> STG3 --> STG4 --> STG5 --> STG6 --> G3 --> STG7

  STG1 -. read .-> KL
  STG2 -. read .-> KL
  STG3 -. read .-> KL
  STG4 -. read .-> KL
  STG5 -. read .-> KL
  STG6 -. read .-> KL
  STG7 -. read .-> KL
```

**Legend**

- **Grey** — user / human.
- **Blue** — orchestrator (Level 0 or Level 1). Never writes code.
- **Yellow** — cross-cutting governance agent (Cost / Audit / Evaluation / Memory).
- **Green** — stage sub-agent team.
- **Red diamond** — human approval gate.

---

## 2. ASCII (fallback)

```
                ┌──────────────────────────┐
                │   User / PM              │   feature / bug /
                │   feature · bug · mod.   │   modernization
                └──────────────┬───────────┘
                               │ trigger
                               ▼
       ╔══════════════════════════════════════════════════╗
       ║  Level 0  Master Orchestrator  (Paperclip)       ║  never writes code
       ║                                                  ║
       ║  session · context · memory · stage trans.       ║
       ║  audit · cost · approvals                        ║
       ╚════════════════┬═════════════╤══════════════════╝
                        │             │
                  intent│       ┌─────┴─────┬─────────┬─────────┐
                        │       ▼           ▼         ▼         ▼
                        │   ┌──────┐    ┌──────┐  ┌──────┐  ┌──────┐
                        │   │ Cost│    │Audit │  │ Eval │  │Memory│   cross-cutting
                        │   └──────┘    └──────┘  └──────┘  └──────┘
                        ▼
       ╔══════════════════════════════════════════════════╗
       ║  Level 1  SDLC Agent  (sub-orchestrator)         ║  never writes code
       ╚════════════════┬═════════════════════════════════╝
                        │
                        ▼
   ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────┐  ┌──────────┐  ┌──────────┐  ┌──────┐
   │1.Ideation│─►│◇ CEO gate    │─►│2.Architect│─►│◇ CTO │─►│3.Dev     │─►│4.QA      │─►│5.Sec  │─►│6.DevOps│─►│◇ CEO+CTO│─►│7.Docs│
   │  BA      │  └──────────────┘  │  Arch+TL  │  │ gate │  │ Dev+Rev  │  │  QA Eng  │  │ SecEng │  │Plat+CA  │  │ gate   │  │Docs │
   └──────────┘                   └──────────────┘  └──────┘  └──────────┘  └──────────┘  └────────┘  └────────┘  └──────┘
        │                              │                │            │              │             │          │         │
        └──────────────────────────────┴────────────────┴────────────┴──────────────┴─────────────┴──────────┴─────────┘
                                                       │
                                                       ▼
                          ┌──────────────────────────────────────────────────┐
                          │  Knowledge Layer                                  │
                          │  workspace/memory   (coding · security · arch ·   │
                          │                     devops)                       │
                          │  workspace/customer (standards · conventions ·    │
                          │                     glossary)                    │
                          │  workspace/project  (PRD · roadmap · tech-stack)  │
                          └──────────────────────────────────────────────────┘
```

---

## 3. How to use

- **PDF / print review** — use the ASCII version with a fixed-width font (Menlo, Consolas, Courier New).
- **Web / Confluence with Mermaid plugin** — use the Mermaid block.
- **Slides** — render the Mermaid block to SVG/PNG (`mmdc -i diagram.mmd -o diagram.png`) and drop into the deck.
- **Code review / PR description** — paste the Mermaid block fenced; GitHub renders it natively.
