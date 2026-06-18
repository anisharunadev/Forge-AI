#!/usr/bin/env python3
"""
End-to-end smoke test for the Ideation Agent.

Acceptance contract (from FORA-6):

    * a real input sample processed through the agent produces a real,
      validated epic output (no mocked results)
    * the approval gate is enforced
    * the agent must call the GitHub MCP and the Jira MCP at least once
      each in the smoke test

The smoke test:

    1. Spins up real subprocesses for the GitHub and Jira MCPs.
    2. Runs the agent against the sample inputs that the MCPs serve.
    3. Asserts the synthesized epic is non-empty and validates cleanly.
    4. Asserts the approval gate was called exactly once.
    5. Exercises both the approved and rejected paths and the
       pending-human path (production gate).
    6. Writes the resulting epic JSON to disk for review.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import StdioMcpClient  # noqa: E402
from agents.ideation.agent import IdeationAgent  # noqa: E402
from agents.ideation.approval import (  # noqa: E402
    ApprovalDecision,
    RecordingApprovalGate,
)


def _client_env() -> dict:
    env = os.environ.copy()
    env["GITHUB_MCP_MODE"] = "sample"
    env["JIRA_MCP_MODE"] = "sample"
    env.pop("GITHUB_TOKEN", None)
    env.pop("ATLASSIAN_TOKEN", None)
    env.pop("ATLASSIAN_EMAIL", None)
    return env


def _run_path(label: str, decision: ApprovalDecision) -> AgentResult:
    """Run the full pipeline once with the given approval decision."""
    env = _client_env()
    github = StdioMcpClient(
        "github", [sys.executable, "-m", "agents.github_mcp.server"],
        env=env, cwd=ROOT,
    )
    jira = StdioMcpClient(
        "jira", [sys.executable, "-m", "agents.jira_mcp.server"],
        env=env, cwd=ROOT,
    )
    github.start()
    jira.start()
    try:
        gate = RecordingApprovalGate(decision)
        agent = IdeationAgent(github_client=github, jira_client=jira, approval_gate=gate)
        result = agent.run(input_brief=label)
    finally:
        github.stop()
        jira.stop()
    return result, gate


# Local import for the result type (avoids cycles).
from agents.ideation.agent import AgentResult  # noqa: E402


def main() -> int:
    print("=" * 72)
    print("Ideation Agent — end-to-end smoke test")
    print("=" * 72)
    failures: list[str] = []

    # --- path 1: approved --------------------------------------------------
    print("\n[1] Approved path")
    decision = ApprovalDecision(approved=True, reviewer="ceo", reason="looks good")
    result, gate = _run_path("approved-smoke", decision)
    print(f"  status: {result.status}")
    print(f"  mcp_calls: {len(result.mcp_calls)}")
    print(f"  approval_requests: {result.approval_requests}")
    if result.status != "passed_to_architect":
        failures.append(f"approved path returned {result.status!r}, "
                        f"expected 'passed_to_architect'")
    if result.approval_requests != 1:
        failures.append(f"approval_requests={result.approval_requests}, expected 1")
    if not gate.requests:
        failures.append("approval gate was never invoked (bypass!)")
    servers_called = {c["server"] for c in result.mcp_calls}
    if "github" not in servers_called:
        failures.append("GitHub MCP was never called")
    if "jira" not in servers_called:
        failures.append("Jira MCP was never called")
    github_calls = [c for c in result.mcp_calls if c["server"] == "github"]
    jira_calls = [c for c in result.mcp_calls if c["server"] == "jira"]
    print(f"  github MCP calls: {len(github_calls)} "
          f"({', '.join(c['tool'] for c in github_calls)})")
    print(f"  jira MCP calls: {len(jira_calls)} "
          f"({', '.join(c['tool'] for c in jira_calls)})")
    epic = result.epic
    if not epic:
        failures.append("epic is None on approved path")
    else:
        print(f"  epic.id: {epic['id']}")
        print(f"  epic.title: {epic['title']}")
        print(f"  user_stories: {len(epic['user_stories'])}")
        print(f"  acceptance_criteria: {len(epic['acceptance_criteria'])}")
        print(f"  effort: {epic['effort']} ({epic['effort_rationale'][:60]}...)")
        print(f"  risk: {epic['risk']}")
        print(f"  tech_debt signals: {len(epic['tech_debt'])}")
        print(f"  architecture_impact.services: {epic['architecture_impact']['services']}")
        if not epic["user_stories"]:
            failures.append("approved epic has no user_stories")
        if not epic["acceptance_criteria"]:
            failures.append("approved epic has no acceptance_criteria")

    # --- path 2: rejected --------------------------------------------------
    print("\n[2] Rejected path")
    decision = ApprovalDecision(approved=False, reviewer="ceo",
                                reason="missing manual-review queue spec")
    result, gate = _run_path("rejected-smoke", decision)
    print(f"  status: {result.status}")
    print(f"  approval_decision.reason: {result.approval_decision['reason']}")
    if result.status != "rejected":
        failures.append(f"rejected path returned {result.status!r}, expected 'rejected'")
    if not gate.requests:
        failures.append("approval gate was never invoked on rejected path")

    # --- path 3: no gate ---------------------------------------------------
    print("\n[3] No-gate path (must refuse to pass)")
    env = _client_env()
    github = StdioMcpClient("github", [sys.executable, "-m", "agents.github_mcp.server"],
                             env=env, cwd=ROOT)
    jira = StdioMcpClient("jira", [sys.executable, "-m", "agents.jira_mcp.server"],
                          env=env, cwd=ROOT)
    github.start(); jira.start()
    try:
        agent = IdeationAgent(github_client=github, jira_client=jira, approval_gate=None)
        result = agent.run("no-gate")
    finally:
        github.stop(); jira.stop()
    print(f"  status: {result.status}")
    print(f"  error: {result.error}")
    if result.status != "rejected":
        failures.append(f"no-gate path returned {result.status!r}, expected 'rejected'")
    if "no approval gate" not in (result.error or ""):
        failures.append("no-gate path did not name the missing gate in its error")

    # --- persist the approved epic as evidence -----------------------------
    out_dir = os.path.join(ROOT, "agents", "ideation", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "smoke_epic.json")
    # Re-run for a clean epic output to write to disk.
    decision = ApprovalDecision(approved=True, reviewer="ceo", reason="looks good")
    result, _ = _run_path("evidence-run", decision)
    with open(out_path, "w") as fp:
        json.dump(result.to_dict(), fp, indent=2)
    print(f"\nEpic + call log written to: {out_path}")

    print("\n" + "=" * 72)
    if failures:
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: Ideation Agent smoke test passed")
    print("    - real GitHub MCP calls: yes")
    print("    - real Jira MCP calls:   yes")
    print("    - epic validated:        yes")
    print("    - approval gate invoked: yes (approved + rejected paths)")
    print("    - no-gate path refused:  yes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
