---
title: QA
description: The QA agent — the fourth stage. Test plans, eval cases, integration tests, and the e2e suite.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/qa.md
generator: readme
approval_required: false
---

The **QA agent** is the fourth stage. It wakes when a PR is merged and CI is green, and produces the **test plan**, **eval cases**, and the **integration + e2e test suite**.

## What it reads

- The PR diff from the Developer stage.
- The ADR from the Architect stage.
- The existing test suite.
- The eval set in `packages/evals/cases/`.

## What it produces

| Artefact | Storage |
| --- | --- |
| Test plan | `docs/test-plans/<feature>.md` |
| Eval cases | `packages/evals/cases/<feature>/` |
| Integration tests | Co-located with the code |
| E2E tests | `e2e/<journey>.spec.ts` |
| QA report | `docs/qa-reports/<pr>.md` |

## The four test tiers

Per [`memory/qa.md` §2](https://github.com/fora-platform/fora/blob/main/workspace/memory/qa.md):

| Tier | Scope | Owner | Cadence | Gating? |
| --- | --- | --- | --- | --- |
| **Unit** | A function or class | Dev | Every commit | Yes |
| **Integration** | Service-to-service | Dev | Every PR | Yes |
| **E2E** | A user journey | QA | Every release | Yes |
| **Eval** | A prompt / contract / agent-loop | QA + Eval | Every PR (capability); weekly (safety) | Yes (capability); warn (safety drift > 5%) |

## Eval set

The eval set lives in `packages/evals/cases/`:

```
packages/evals/cases/
├── capability/         # does the agent do the right thing?
│   ├── ideation/
│   ├── architect/
│   ├── developer/
│   ├── qa/
│   ├── security/
│   └── docs/
├── safety/             # does the agent refuse the wrong thing?
│   ├── prompt-injection/   # LLM01
│   ├── exfiltration/       # LLM02-LLM05
│   ├── scope-escalation/   # LLM06-LLM08
│   ├── pii-leakage/        # LLM09
│   └── over-refusal/       # LLM10
└── golden/             # end-to-end staged workflow traces
    ├── forge-feature/
    └── jira-bug/
```

A eval set regression > 5% is a P2 process bug. The QA agent opens a child issue and the eval owner triages.

## When it fails

| Failure | Behaviour |
| --- | --- |
| Unit tests fail | Reject the PR; return to Dev |
| Integration tests fail | Reject; return to Dev |
| E2E tests fail | Open a bug; halt the stage |
| Capability eval regression > 5% | Open a ticket; CTO reviews |
| Safety eval regression > 0% | **Block the release** |

## Where to next

- **[Developer →](/agents/developer/)** — the previous stage.
- **[Security →](/agents/security/)** — the next stage.
- **[Architecture → Staged workflow →](/architecture/staged-workflow/)** — the full pipeline.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/qa.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
