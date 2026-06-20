# Ideation Agent — playbook

## What this stage does

Pulls signal from Jira / GitHub / Zendesk / Confluence / SonarQube / Market
Intel, synthesizes a structured Epic, and gates handoff to the Architect
Agent behind an explicit human approval. The agent refuses to bypass the
gate; the no-gate path is a hard error, not a silent pass.

## How to invoke

```python
from agents._shared.mcp_client import StdioMcpClient
from agents.ideation.agent import IdeationAgent
from agents.ideation.approval import PaperclipApprovalGate

with StdioMcpClient("github", [sys.executable, "-m", "agents.github_mcp.server"], env=github_env) as gh, \
     StdioMcpClient("jira",   [sys.executable, "-m", "agents.jira_mcp.server"],   env=jira_env)   as ji:
    gate = PaperclipApprovalGate(
        api_url=PAPERCLIP_API_URL, api_key=PAPERCLIP_API_KEY,
        issue_id=Forge AI_6_ISSUE_ID, run_id=PAPERCLIP_RUN_ID,
    )
    agent = IdeationAgent(github_client=gh, jira_client=ji, approval_gate=gate)
    result = agent.run(input_brief=...)
    # result.status in {passed_to_architect, rejected, pending_human_review}
```

## Non-obvious design choices

1. **Synthesizer is rule-based, not LLM-backed.** Deterministic, replayable,
   auditable. An LLM-backed synthesizer can replace it later without
   changing the agent's contract.
2. **Both MCPs share `_shared/jsonrpc.py` and `_shared/mcp_client.py`.**
   Same wire format as the MCP stdio transport; same client class.
3. **Every response carries a `mode` field** (`"live"` or `"sample"`) so a
   reviewer can always tell where the input came from. Never strip this.
4. **The approval gate is a callable**, not a class hierarchy. Production
   uses `PaperclipApprovalGate`; tests use `RecordingApprovalGate`.
5. **Audit trail is captured inside the result.** Every MCP call lands
   in `result.mcp_calls` with `tool`, `args`, `ok`, `error`,
   `duration_ms`. The Audit Agent reads this.

## When a future agent should NOT change this

- The Epic schema. Downstream stages consume it; the contract is the
  contract.
- The approval gate's location in the flow. It is the spine of
  agent-of-agents governance; moving it requires a CEO sign-off.
- The MCP tool surface. Both servers are the template for Confluence,
  SonarQube, Figma, AWS, Slack/Teams, Zendesk, Databricks, Azure DevOps.

## Smoke tests

- `python -m agents.github_mcp.smoke_test` — green
- `python -m agents.jira_mcp.smoke_test` — green
- `python -m agents.ideation.smoke_test` — green (writes `evidence/smoke_epic.json`)

## Owners

- [Forge AI-6](/Forge AI/issues/Forge AI-6) — Ideation Agent (CTO, done 2026-06-16)
- [Forge AI-4](/Forge AI/issues/Forge AI-4) — GitHub MCP (CTO, done 2026-06-16)
- [Forge AI-8](/Forge AI/issues/Forge AI-8) — Jira MCP (CTO, done 2026-06-16)

## Related

- The next stage's playbook: see [architecture.md](./architecture.md) for the handoff contract and ADR template
- The QA stage's playbook (tiers, Security handoff, v2 cost budget): see [qa.md](./qa.md)
- The Coding bar every story must clear: see [coding.md](./coding.md)
- The Customer files injected alongside this one: see [customer/conventions.md](../customer/conventions.md) and [customer/glossary.md](../customer/glossary.md)
- The product this ideation serves: see [project/PRD.md](../project/PRD.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it changes the Epic schema, moves or removes the human-approval gate, or changes the MCP tool surface that downstream stages consume. A change that weakens the no-bypass rule on the approval gate is rejected. The CTO owns merges to this file; the BA / Ideation stage owner co-signs.
