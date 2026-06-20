# Ideation Agent (Forge AI-6)

Stage 1 of the Forge AI SDLC pipeline. The first concrete sub-agent.

## What it does

Given a real input signal set (Jira, GitHub, Zendesk, Confluence,
SonarQube, Market Intel), it produces a validated `Epic` with:

- `user_stories[]` — prioritized, story-pointed
- `acceptance_criteria[]` — Given/When/Then
- `dependencies[]` — internal repos, external systems, MCPs
- `effort` + `effort_rationale`
- `risk` + `risk_summary`
- `tech_debt[]` — pulled from SonarQube
- `architecture_impact` — services, data, API, cross-cutting
- `sources[]` — provenance trail for every input slice

The epic is then sent through a **mandatory human approval gate** before
it can be handed to the Architect Agent. Bypassing the gate is a
hard error.

## Layout

```
agents/ideation/
  schemas.py        # Epic, UserStory, AcceptanceCriterion, ... + validation
  collectors.py     # one collector per source (MCP-backed or sample)
  synthesizer.py    # rule-based, deterministic Epic synthesis
  approval.py       # PaperclipApprovalGate + RecordingApprovalGate
  agent.py          # the agent class; composes everything
  smoke_test.py     # end-to-end smoke test
  evidence/         # produced artifacts from the smoke test
```

## MCPs it calls

| Server    | Tools used                            | Mode    |
| --------- | ------------------------------------- | ------- |
| `github`  | `list_repos`, `list_prs`, `list_issues` | sample / live |
| `jira`    | `list_projects`, `list_issues`        | sample / live |

The other four sources (Zendesk, Confluence, SonarQube, Market Intel)
are best-effort. They each have a deterministic local collector that
returns well-formed sample data today, and a one-line swap to a real
MCP-backed collector when those MCPs ship.

## Approval gate

The gate is an injected callable. Two implementations ship:

- `PaperclipApprovalGate` — production. Posts a
  `request_confirmation` interaction to the issue thread and waits for
  the board to accept or reject. Wakes the agent with the decision.
- `RecordingApprovalGate` — smoke tests. Returns a pre-set decision and
  records the request so the test can assert the gate was actually
  invoked.

The agent refuses to produce a `passed_to_architect` status if:

- no gate is configured, or
- the epic fails schema validation.

## Smoke test

```
python -m agents.ideation.smoke_test
```

Exercises:

1. **Approved path** — real MCPs, real synthesis, gate approves, agent
   returns `passed_to_architect`.
2. **Rejected path** — same pipeline, gate rejects, agent returns
   `rejected` with the reviewer's reason.
3. **No-gate path** — gate is `None`; agent must refuse, not silently
   pass the epic through.

Writes the approved epic + MCP call log to
`agents/ideation/evidence/smoke_epic.json`.

## Production wiring

```python
from agents._shared.mcp_client import StdioMcpClient
from agents.ideation.agent import IdeationAgent
from agents.ideation.approval import PaperclipApprovalGate

with StdioMcpClient("github", [...], env=github_env) as gh, \
     StdioMcpClient("jira",   [...], env=jira_env)   as ji:
    gate = PaperclipApprovalGate(
        api_url=PAPERCLIP_API_URL,
        api_key=PAPERCLIP_API_KEY,
        issue_id=Forge AI_6_ISSUE_ID,
        run_id=PAPERCLIP_RUN_ID,
    )
    agent = IdeationAgent(github_client=gh, jira_client=ji, approval_gate=gate)
    result = agent.run(input_brief=...)
    # result.status in {passed_to_architect, rejected, pending_human_review}
```

## Where this fits in the SDLC pipeline

```
                    ┌────────────────────┐
                    │  Master Orchestr.  │
                    │  (Paperclip)       │
                    └─────────┬──────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │   SDLC Agent         │
                  │   (sub-orchestrator) │
                  └─────────┬────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        [BA / Product] [Architect]    [Code/Dev/QA/...]
              ▲
              │
        ┌─────┴────────┐
        │   Forge AI-6     │  ◀── THIS AGENT
        │   Ideation   │
        └─────┬────────┘
              │ passes only after human approval
              ▼
        Stage 2: Architect Agent
```

## Knowledge layer

The agent injects the following files from `workspace/` before
synthesis (this is wired in the orchestrator, not here):

- `workspace/memory/ideation.md` — playbook
- `workspace/project/PRD.md` — product goals
- `workspace/customer/standards.md` — customer conventions

The agent itself is source-agnostic; it consumes whatever signals the
collectors produce.
