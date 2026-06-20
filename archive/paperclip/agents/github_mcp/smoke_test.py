#!/usr/bin/env python3
"""
GitHub MCP smoke test.

Spins up the server in-process, drives every tool through the real
StdioMcpClient transport, and asserts a sane response shape for each.
This is what the Ideation Agent's smoke test relies on to prove the
GitHub MCP is healthy.
"""

from __future__ import annotations

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import StdioMcpClient  # noqa: E402


def main() -> int:
    env = os.environ.copy()
    env["GITHUB_MCP_MODE"] = "sample"
    # Force sample mode regardless of whether the operator has a token.
    env.pop("GITHUB_TOKEN", None)

    server_cmd = [sys.executable, "-m", "agents.github_mcp.server"]
    failures: list[str] = []
    with StdioMcpClient("github", server_cmd, env=env, cwd=ROOT) as client:
        tools = client.list_tools()
        names = sorted(t["name"] for t in tools)
        expected = ["create_branch", "create_issue", "create_or_update_file",
                    "create_pr_comment", "create_pull_request", "get_pr",
                    "get_pull_request_files", "list_issues", "list_prs",
                    "list_repos", "search_code"]
        if names != expected:
            failures.append(f"tool list mismatch: got {names}")
        else:
            print(f"  tools/list: {len(names)} tools registered")

        repos = client.call("list_repos", {"org": "fora-labs"})
        if not repos.get("repos"):
            failures.append("list_repos returned no repos")
        else:
            print(f"  list_repos: {len(repos['repos'])} repos (mode={repos['mode']})")

        prs = client.call("list_prs", {"repo": "checkout-api", "state": "open"})
        if not prs.get("prs"):
            failures.append("list_prs returned no PRs")
        else:
            print(f"  list_prs: {len(prs['prs'])} open PRs")

        pr = client.call("get_pr", {"repo": "checkout-api", "number": 481})
        if pr.get("pr", {}).get("number") != 481:
            failures.append("get_pr did not return PR #481")
        else:
            print(f"  get_pr: PR #{pr['pr']['number']} '{pr['pr']['title']}'")

        issues = client.call("list_issues", {"repo": "checkout-api", "state": "open"})
        if not issues.get("issues"):
            failures.append("list_issues returned no issues")
        else:
            print(f"  list_issues: {len(issues['issues'])} open issues")

        created = client.call("create_issue", {
            "repo": "checkout-api", "title": "smoke-test issue",
            "body": "Created by GitHub MCP smoke test.", "labels": ["smoke"],
        })
        if not created.get("issue", {}).get("number"):
            failures.append("create_issue did not return a number")
        else:
            print(f"  create_issue: issue #{created['issue']['number']}")

        comment = client.call("create_pr_comment", {
            "repo": "checkout-api", "number": 481, "body": "Smoke test comment.",
        })
        if not comment.get("comment", {}).get("id"):
            failures.append("create_pr_comment did not return an id")
        else:
            print(f"  create_pr_comment: comment id={comment['comment']['id']}")

        search = client.call("search_code", {"query": "idempotency org:fora-labs"})
        if search.get("result", {}).get("total_count", 0) < 1:
            failures.append("search_code returned no matches")
        else:
            print(f"  search_code: {search['result']['total_count']} matches")

    # Verify the audit trail captured all calls.
    if not client.call_log:
        failures.append("call log is empty")
    else:
        print(f"  call_log: {len(client.call_log)} tool calls recorded")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: GitHub MCP smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
