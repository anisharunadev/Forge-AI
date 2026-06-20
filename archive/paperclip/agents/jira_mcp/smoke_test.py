#!/usr/bin/env python3
"""
Jira MCP smoke test (FORA-8).

Drives every tool through the real StdioMcpClient transport and asserts
sane response shapes. Same shape as the GitHub MCP smoke test so a
single runner can execute both in CI.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import StdioMcpClient  # noqa: E402


def main() -> int:
    env = os.environ.copy()
    env["JIRA_MCP_MODE"] = "sample"
    env.pop("ATLASSIAN_TOKEN", None)
    env.pop("ATLASSIAN_EMAIL", None)

    server_cmd = [sys.executable, "-m", "agents.jira_mcp.server"]
    failures: list[str] = []
    with StdioMcpClient("jira", server_cmd, env=env, cwd=ROOT) as client:
        tools = client.list_tools()
        names = sorted(t["name"] for t in tools)
        expected = ["add_comment", "create_issue", "get_issue", "list_issues",
                    "list_projects", "transition_issue", "update_issue"]
        if names != expected:
            failures.append(f"tool list mismatch: got {names}")
        else:
            print(f"  tools/list: {len(names)} tools registered")

        projects = client.call("list_projects")
        if not projects.get("projects"):
            failures.append("list_projects returned no projects")
        else:
            print(f"  list_projects: {len(projects['projects'])} projects")

        issues = client.call("list_issues", {"jql": "project=CHECK status=Open"})
        if not issues.get("issues"):
            failures.append("list_issues returned no issues")
        else:
            print(f"  list_issues: {len(issues['issues'])} open CHECK issues")

        issue = client.call("get_issue", {"key": "FORA-6"})
        if issue.get("issue", {}).get("key") != "FORA-6":
            failures.append("get_issue did not return FORA-6")
        else:
            print(f"  get_issue: {issue['issue']['key']} = "
                  f"'{issue['issue']['fields']['summary'][:50]}'")

        created = client.call("create_issue", {
            "project": "FORA", "summary": "smoke-test issue",
            "body": "Created by Jira MCP smoke test.",
            "issue_type": "Task", "labels": ["smoke"],
        })
        if not created.get("issue", {}).get("key"):
            failures.append("create_issue did not return a key")
        else:
            print(f"  create_issue: {created['issue']['key']}")

        updated = client.call("update_issue", {
            "key": "FORA-6",
            "fields": {"priority": {"name": "Critical"}},
        })
        if not updated.get("updated"):
            failures.append("update_issue did not return updated=true")
        else:
            print(f"  update_issue: {updated['key']} priority -> "
                  f"{updated['issue']['fields']['priority']['name']}")

        comment = client.call("add_comment", {
            "key": "FORA-6", "body": "Smoke test comment.",
        })
        if not comment.get("comment", {}).get("id"):
            failures.append("add_comment did not return an id")
        else:
            print(f"  add_comment: comment id={comment['comment']['id']}")

        # Transition FORA-6 from In Progress -> In Review (allowed by fixture).
        transition = client.call("transition_issue", {
            "key": "FORA-6", "transition": "In Review",
        })
        if not transition.get("applied"):
            failures.append("transition_issue did not return applied=true")
        else:
            print(f"  transition_issue: {transition['from']} -> {transition['to']}")

        # A disallowed transition must raise. The server started above is gone
        # now, so we spawn a fresh one for the negative test.
        from agents.jira_mcp.server import make_server
        srv = make_server()
        denied = srv.handle_request_line(json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "transition_issue",
                       "arguments": {"key": "FORA-6", "transition": "Done"}},
        }))
        denied_obj = json.loads(denied) if denied else {}
        if "error" not in denied_obj or denied_obj["error"].get("code") != -32602:
            failures.append("disallowed transition did not return INVALID_PARAMS")
        else:
            print("  transition_issue (denied): returns INVALID_PARAMS as expected")

    if not client.call_log:
        failures.append("call log is empty")
    else:
        print(f"  call_log: {len(client.call_log)} tool calls recorded")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: Jira MCP smoke test passed")
    return 0


if __name__ == "__main__":
    import json
    raise SystemExit(main())
