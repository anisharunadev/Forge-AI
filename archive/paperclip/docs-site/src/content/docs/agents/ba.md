---
title: BA (Ideation)
description: The BA agent — the first stage. Drafts PRDs and Jira epics from one-line prompts.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/memory/architecture.md
generator: readme
approval_required: false
---

The **BA agent** is the Ideation stage of the staged workflow. It wakes when a new run enters the system (via Slack, the Forge console, the CLI, or the API) and produces the first artefact: a **PRD draft** and a **Jira Epic**.

## What it reads

From the Knowledge Layer:

- `workspace/customer/conventions.md` — customer's naming, severity, priority matrices.
- `workspace/customer/glossary.md` — customer's vocabulary.
- `workspace/customer/standards.md` — inherited standards (SOC 2, ISO 27001, OWASP, etc.).
- `engagements/<slug>/conventions.md` — customer-specific overrides.
- `workspace/project/PRD.md` — the master PRD (for style).
- `workspace/project/roadmap.md` — current quarter and bet.

## What it produces

| Artefact | Format | Storage |
| --- | --- | --- |
| **PRD draft** | Markdown | `workspace/customer/engagements/<slug>/prds/<id>.md` |
| **Jira Epic** | Atlassian Document Format | Jira (via the Jira MCP server) |
| **Cost report** | JSON | Cost agent's table |

The PRD follows the structure of [`workspace/project/PRD.md`](https://github.com/fora-platform/fora/blob/main/workspace/project/PRD.md) — same sections, same vocabulary, same links.

## The agent loop

```text
1. Read tenant context + customer conventions
2. Read the source prompt (Slack message, Forge input, etc.)
3. Draft the PRD (sections 1-10 of the master PRD)
4. Create the Jira Epic (via the Jira MCP server)
5. Hand off to the Architect stage
```

## The plan-then-act contract

The BA agent's plan is:

```typescript
const plan = {
  version: '1.0.0',
  fromStage: 'ideation',
  toStage: 'architect',
  inputSchema: PRDInputSchema,
  outputSchema: PRDOutputSchema,
  example: { input: {...}, output: {...} },
  sla: { p50_ms: 30000, p99_ms: 90000, max_retries: 2 },
  tools: [
    'jira.create_epic',
    'jira.search_issue',
    'knowledge.read',
    'slack.post_message',
  ],
};
```

The runtime validates the plan against the BA's allow-list before any tool executes. A tool not in the plan is refused.

## When it fails

| Failure | Behaviour |
| --- | --- |
| Customer conventions missing | Halt with "missing-engagement-conventions" |
| Jira MCP unavailable | Retry 3×, then escalate to on-call |
| LLM provider outage | Circuit-breaker, fallback to OpenAI |
| Cost ceiling hit | Halt with "human-approval-required" |
| PRD draft rejected by owner | Return to step 3 with the reviewer's notes |

## Where to next

- **[Master Orchestrator →](/agents/master-orchestrator/)** — the brain.
- **[Architect →](/agents/architect/)** — the next stage.
- **[Staged workflow →](/architecture/staged-workflow/)** — the full pipeline.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/memory/architecture.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
