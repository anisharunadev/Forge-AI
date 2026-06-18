#!/usr/bin/env python3
"""
GitHub MCP server (priority-1 MCP, FORA-4).

Exposes the seven tools the Ideation Agent needs from GitHub:
    list_repos, get_pr, list_prs, create_pr_comment,
    list_issues, create_issue, search_code.

Two modes:
    * live  - real REST calls to api.github.com using GITHUB_TOKEN
    * sample - fixture-backed mode for offline / smoke-test runs

The mode is selected by the GITHUB_MCP_MODE env var. Default is `sample`
when no token is present, `live` when GITHUB_TOKEN is set. This keeps the
smoke test deterministic and the production path honest.

This is the template the Jira MCP follows; see FORA-8.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional
import base64

# Allow `python -m agents.github_mcp.server` from the project root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from agents._shared.jsonrpc import (  # noqa: E402
    AUTH_MISSING,
    INVALID_PARAMS,
    INTERNAL_ERROR,
    JsonRpcError,
    StdioJsonRpcServer,
    tool,
)

GITHUB_API = "https://api.github.com"
DEFAULT_ORG = os.environ.get("GITHUB_MCP_ORG", "fora-labs")
DEFAULT_MODE = "live" if os.environ.get("GITHUB_TOKEN") else "sample"


def _b64(s: str) -> str:
    """Base64-encode a string for the GitHub contents API."""
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


# ---------------------------------------------------------------------------
# Sample data fixture
# ---------------------------------------------------------------------------
# This is intentionally NOT the agent's epic output. It is the input
# signal the agent consumes. Keeping it small, dated, and obviously
# synthetic means a reviewer can tell at a glance: "yes, this is real
# structured GitHub data, no, the agent didn't fabricate the epic."

SAMPLE_REPOS = [
    {"name": "checkout-api", "full_name": "fora-labs/checkout-api",
     "description": "Checkout service: cart, payment, fraud, orders",
     "default_branch": "main", "visibility": "private",
     "open_issues_count": 17, "forks_count": 2, "stargazers_count": 0,
     "updated_at": "2026-06-14T09:21:00Z"},
    {"name": "fulfillment-svc", "full_name": "fora-labs/fulfillment-svc",
     "description": "Order fulfillment and warehouse routing",
     "default_branch": "main", "visibility": "private",
     "open_issues_count": 9, "forks_count": 0, "stargazers_count": 0,
     "updated_at": "2026-06-13T17:02:00Z"},
    {"name": "merchant-portal", "full_name": "fora-labs/merchant-portal",
     "description": "Merchant-facing web app (Next.js)",
     "default_branch": "main", "visibility": "private",
     "open_issues_count": 23, "forks_count": 1, "stargazers_count": 0,
     "updated_at": "2026-06-15T11:48:00Z"},
]

SAMPLE_PRS = [
    {"number": 481, "title": "checkout: pre-auth hold on card capture",
     "state": "open", "user": {"login": "alice"},
     "head": {"ref": "feat/preauth-hold",
              "sha": "abc1234567890abcdef1234567890abcdef123456"},
     "base": {"ref": "main"}, "created_at": "2026-06-12T10:00:00Z",
     "comments": 4, "additions": 312, "deletions": 41,
     "body": "Adds a 5-second pre-auth hold before capturing the card. "
             "Reduces chargeback rate on retry-heavy customers."},
    {"number": 478, "title": "fulfillment: weighted warehouse routing",
     "state": "open", "user": {"login": "bo"},
     "head": {"ref": "feat/weighted-routing",
              "sha": "0123456789abcdef0123456789abcdef01234567"},
     "base": {"ref": "main"}, "created_at": "2026-06-10T14:00:00Z",
     "comments": 7, "additions": 580, "deletions": 120,
     "body": "Routes orders to warehouses using a weighted score (capacity, "
             "distance, SLA tier). Replaces the round-robin stub."},
    {"number": 502, "title": "merchant-portal: accessibility audit followups",
     "state": "merged", "user": {"login": "cathy"},
     "head": {"ref": "chore/a11y",
              "sha": "1111222233334444555566667777888899990000"},
     "base": {"ref": "main"}, "created_at": "2026-06-08T09:00:00Z",
     "comments": 12, "additions": 245, "deletions": 198,
     "body": "Resolves the WCAG 2.1 AA findings from the Q2 audit."},
    # FORA-49: PR #482 backs the QA smoke test happy path. The
    # sample `get_pull_request_files` already lists files for 482;
    # without a matching PR object here the publisher can't resolve
    # the head SHA. SHA matches the pre-seeded `feat/idempotency-2`
    # branch in `_SAMPLE_BRANCHES`.
    {"number": 482, "title": "checkout: idempotency ttl follow-up",
     "state": "open", "user": {"login": "ops-bot"},
     "head": {"ref": "feat/idempotency-2",
              "sha": "2222333344445555666677778888999900001111"},
     "base": {"ref": "main"}, "created_at": "2026-06-13T10:00:00Z",
     "comments": 2, "additions": 18, "deletions": 4,
     "body": "Aligns the idempotency TTL with the follow-up issue."},
]

SAMPLE_ISSUES = [
    {"number": 1240, "title": "Idempotency keys expire before retries settle",
     "state": "open", "labels": [{"name": "bug"}, {"name": "checkout"}],
     "user": {"login": "ops-bot"}, "created_at": "2026-06-09T07:11:00Z",
     "comments": 6,
     "body": "We see ~0.4% of checkout retries land after the 24h idempotency "
             "window, producing duplicate orders. Need a longer TTL or a "
             "two-phase commit."},
    {"number": 1238, "title": "Fraud rules block ~3% of legitimate EU cards",
     "state": "open", "labels": [{"name": "fraud"}, {"name": "EU"}],
     "user": {"login": "alice"}, "created_at": "2026-06-08T15:30:00Z",
     "comments": 9,
     "body": "False-positive rate on EU debit cards is 3.1%. Need a region-"
             "tuned rule set or a manual review path for low-confidence blocks."},
    {"number": 1229, "title": "Warehouse routing: distance calc uses Haversine",
     "state": "open", "labels": [{"name": "enhancement"}, {"name": "fulfillment"}],
     "user": {"login": "bo"}, "created_at": "2026-06-04T11:00:00Z",
     "comments": 4,
     "body": "Replace Haversine with a road-network distance for the EU region "
             "to improve ETA accuracy."},
]

SAMPLE_SEARCH = {
    "total_count": 2,
    "items": [
        {"path": "services/checkout/src/idempotency.py",
         "repository": {"full_name": "fora-labs/checkout-api"},
         "text_matches": [{"fragment": "def claim_idempotency_key(..."}]},
        {"path": "services/fulfillment/src/routing.py",
         "repository": {"full_name": "fora-labs/fulfillment-svc"},
         "text_matches": [{"fragment": "def weighted_score(..."}]},
    ],
}


# --- FORA-49: QA publisher sample state ----------------------------------
# Sample data backs the four publisher tools in offline / smoke-test runs.
# The sample keeps an in-memory map of branches and committed files so
# the publisher can round-trip a full PR-creation flow without hitting
# GitHub. The state resets every time the server boots.

_SAMPLE_BRANCHES: Dict[str, Dict[str, str]] = {
    # Pre-seed: every fixture PR's head ref is reachable so the publisher
    # can fork `qa/test-gen` from it.
    "fora-labs/checkout-api": {
        "feat/preauth-hold":    "abc1234567890abcdef1234567890abcdef123456",
        "feat/idempotency-2":   "2222333344445555666677778888999900001111",
        "main":                  "def4567890abcdef1234567890abcdef12345678",
    },
    "fora-labs/fulfillment-svc": {
        "feat/weighted-routing": "0123456789abcdef0123456789abcdef01234567",
        "main":                  "fedcba9876543210fedcba9876543210fedcba98",
    },
}

# Files committed on a `qa/test-gen` branch, keyed by (repo, branch, path).
_SAMPLE_FILES: Dict[str, Dict[str, str]] = {}

# PRs opened from a `qa/test-gen` branch, keyed by (repo, head).
_SAMPLE_QA_PRS: Dict[str, Dict[str, Any]] = {}

# Per-PR file listings used by `get_pull_request_files` in sample mode.
# Keyed by PR number so the publisher can fetch files for either fixture
# PR (FORA-org/checkout-api#482 / #483 in the QA smoke test).
_SAMPLE_PR_FILES: Dict[int, List[Dict[str, Any]]] = {
    481: [
        {"filename": "services/checkout/src/preauth.py", "status": "added",
         "additions": 312, "deletions": 0, "changes": 312,
         "patch": "@@ -0,0 +1,80 @@\n+def preauth_hold(...):\n+    ...\n"},
        {"filename": "services/checkout/src/idempotency.py", "status": "modified",
         "additions": 41, "deletions": 41, "changes": 82,
         "patch": "@@ -10,6 +10,7 @@\n+KEY_TTL=...\n"},
    ],
    482: [
        {"filename": "api/v1/openapi.yaml", "status": "modified",
         "additions": 18, "deletions": 4, "changes": 22,
         "patch": "@@ -1,3 +1,5 @@\n+openapi: 3.1.0\n"},
    ],
    483: [
        {"filename": "services/fulfillment/src/routing.py", "status": "modified",
         "additions": 580, "deletions": 120, "changes": 700,
         "patch": "@@ -1,10 +1,30 @@\n+def weighted_score(...):\n+    ...\n"},
    ],
}


# ---------------------------------------------------------------------------
# Live REST client
# ---------------------------------------------------------------------------

class GitHubClient:
    def __init__(self, token: str) -> None:
        self._token = token

    def _request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{GITHUB_API}{path}"
        data = None
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "fora-github-mcp/0.1.0",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = resp.read()
                if not payload:
                    return {}
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise JsonRpcError(AUTH_MISSING, f"github auth failed: HTTP {exc.code}")
            raise JsonRpcError(INTERNAL_ERROR, f"github upstream HTTP {exc.code}: {exc.reason}")

    def list_repos(self, org: str) -> List[Dict[str, Any]]:
        return self._request(f"/orgs/{org}/repos?per_page=50&sort=updated")

    def get_pr(self, repo: str, number: int) -> Dict[str, Any]:
        return self._request(f"/repos/{repo}/pulls/{number}")

    def list_prs(self, repo: str, state: str = "open") -> List[Dict[str, Any]]:
        return self._request(f"/repos/{repo}/pulls?state={state}&per_page=30")

    def create_pr_comment(self, repo: str, number: int, body: str) -> Dict[str, Any]:
        return self._request(f"/repos/{repo}/issues/{number}/comments", "POST", {"body": body})

    def list_issues(self, repo: str, state: str = "open") -> List[Dict[str, Any]]:
        return self._request(f"/repos/{repo}/issues?state={state}&per_page=30")

    def create_issue(self, repo: str, title: str, body: str, labels: Optional[List[str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"title": title, "body": body}
        if labels:
            payload["labels"] = labels
        return self._request(f"/repos/{repo}/issues", "POST", payload)

    def search_code(self, query: str) -> Dict[str, Any]:
        return self._request(f"/search/code?q={urllib.parse.quote(query)}&per_page=20")

    # --- FORA-49: QA publisher surface ---------------------------------
    # These four tools back `agents/qa/github_publisher.py`. The QA
    # agent never writes to the user repo directly; it opens / updates
    # a `qa/test-gen` branch and routes the merge through the DevOps
    # gate (per architecture.md §3).

    def get_pull_request_files(self, repo: str, number: int) -> List[Dict[str, Any]]:
        return self._request(f"/repos/{repo}/pulls/{number}/files?per_page=100")

    def get_branch(self, repo: str, branch: str) -> Dict[str, Any]:
        return self._request(f"/repos/{repo}/branches/{urllib.parse.quote(branch)}")

    def create_branch(self, repo: str, branch: str, from_sha: str) -> Dict[str, Any]:
        """Create a branch pointing at `from_sha`. Idempotent: if the branch
        already exists, callers should treat that as success."""
        return self._request(
            f"/repos/{repo}/git/refs/heads/{urllib.parse.quote(branch)}",
            "POST",
            {"ref": f"refs/heads/{branch}", "sha": from_sha},
        )

    def create_or_update_file(self, repo: str, branch: str, path: str,
                              content: str, message: str,
                              sha: Optional[str] = None) -> Dict[str, Any]:
        """Create or update a file in a branch. Pass `sha` to update."""
        payload: Dict[str, Any] = {
            "message": message,
            "content": _b64(content),
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha
        return self._request(
            f"/repos/{repo}/contents/{urllib.parse.quote(path, safe='/')}",
            "PUT",
            payload,
        )

    def create_pull_request(self, repo: str, head: str, base: str,
                            title: str, body: str) -> Dict[str, Any]:
        return self._request(
            f"/repos/{repo}/pulls", "POST",
            {"title": title, "head": head, "base": base, "body": body,
             "maintainer_can_modify": True},
        )


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def _repo_full_name(arguments: Dict[str, Any], default_org: str) -> str:
    repo = arguments.get("repo")
    org = arguments.get("org") or default_org
    if not repo or not isinstance(repo, str):
        raise JsonRpcError(INVALID_PARAMS, "repo is required (e.g. 'checkout-api')")
    if "/" in repo:
        return repo
    return f"{org}/{repo}"


def make_server() -> StdioJsonRpcServer:
    mode = os.environ.get("GITHUB_MCP_MODE", DEFAULT_MODE)
    default_org = os.environ.get("GITHUB_MCP_ORG", DEFAULT_ORG)
    token = os.environ.get("GITHUB_TOKEN")
    live = mode == "live"
    client = GitHubClient(token) if live and token else None
    if live and client is None:
        # Live requested but no token; degrade to sample with a clear log line.
        sys.stderr.write("[github_mcp] GITHUB_MCP_MODE=live but no GITHUB_TOKEN; using sample data\n")
        mode = "sample"

    server = StdioJsonRpcServer(name="github-mcp", version="0.1.0")

    @tool(
        name="list_repos",
        description="List repositories in an org or for a user.",
        input_schema={
            "type": "object",
            "properties": {
                "org": {"type": "string", "description": "GitHub org or user login"},
            },
        },
    )
    def list_repos(arguments: Dict[str, Any]) -> Any:
        org = arguments.get("org") or default_org
        if mode == "live":
            return {"mode": "live", "org": org, "repos": client.list_repos(org)}
        return {"mode": "sample", "org": org, "repos": SAMPLE_REPOS,
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live for real repos."}

    @tool(
        name="get_pr",
        description="Get a single pull request by repo and number.",
        input_schema={
            "type": "object",
            "required": ["repo", "number"],
            "properties": {
                "repo": {"type": "string"},
                "number": {"type": "integer"},
            },
        },
    )
    def get_pr(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        number = int(arguments.get("number", 0))
        if mode == "live":
            return {"mode": "live", "repo": repo, "number": number, "pr": client.get_pr(repo, number)}
        for pr in SAMPLE_PRS:
            if pr["number"] == number:
                return {"mode": "sample", "repo": repo, "number": number, "pr": pr}
        raise JsonRpcError(INVALID_PARAMS, f"no sample PR #{number} in fixture")

    @tool(
        name="list_prs",
        description="List pull requests for a repo, filtered by state.",
        input_schema={
            "type": "object",
            "required": ["repo"],
            "properties": {
                "repo": {"type": "string"},
                "state": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"},
            },
        },
    )
    def list_prs(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        state = arguments.get("state", "open")
        if mode == "live":
            return {"mode": "live", "repo": repo, "state": state, "prs": client.list_prs(repo, state)}
        prs = [p for p in SAMPLE_PRS if state == "all" or p["state"] == state]
        return {"mode": "sample", "repo": repo, "state": state, "prs": prs,
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live for real PRs."}

    @tool(
        name="create_pr_comment",
        description="Create a comment on a pull request.",
        input_schema={
            "type": "object",
            "required": ["repo", "number", "body"],
            "properties": {
                "repo": {"type": "string"},
                "number": {"type": "integer"},
                "body": {"type": "string"},
            },
        },
    )
    def create_pr_comment(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        number = int(arguments.get("number", 0))
        body = arguments.get("body", "")
        if not isinstance(body, str) or not body.strip():
            raise JsonRpcError(INVALID_PARAMS, "body is required and must be a non-empty string")
        if mode == "live":
            return {"mode": "live", "repo": repo, "number": number,
                    "comment": client.create_pr_comment(repo, number, body)}
        return {"mode": "sample", "repo": repo, "number": number,
                "comment": {"id": 99001, "body": body, "user": {"login": "fora-bot"},
                            "created_at": "2026-06-16T18:00:00Z"},
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live to post a real comment."}

    @tool(
        name="list_issues",
        description="List issues for a repo, filtered by state.",
        input_schema={
            "type": "object",
            "required": ["repo"],
            "properties": {
                "repo": {"type": "string"},
                "state": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"},
            },
        },
    )
    def list_issues(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        state = arguments.get("state", "open")
        if mode == "live":
            return {"mode": "live", "repo": repo, "state": state,
                    "issues": client.list_issues(repo, state)}
        issues = [i for i in SAMPLE_ISSUES if state == "all" or i["state"] == state]
        return {"mode": "sample", "repo": repo, "state": state, "issues": issues,
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live for real issues."}

    @tool(
        name="create_issue",
        description="Create a new issue in a repo.",
        input_schema={
            "type": "object",
            "required": ["repo", "title", "body"],
            "properties": {
                "repo": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "labels": {"type": "array", "items": {"type": "string"}},
            },
        },
    )
    def create_issue(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        title = arguments.get("title", "")
        body = arguments.get("body", "")
        if not title.strip():
            raise JsonRpcError(INVALID_PARAMS, "title is required")
        labels = arguments.get("labels") or []
        if mode == "live":
            return {"mode": "live", "repo": repo,
                    "issue": client.create_issue(repo, title, body, labels)}
        return {"mode": "sample", "repo": repo,
                "issue": {"number": 1250, "title": title, "body": body,
                          "state": "open", "labels": [{"name": l} for l in labels],
                          "user": {"login": "fora-bot"},
                          "created_at": "2026-06-16T18:00:00Z"},
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live to open a real issue."}

    @tool(
        name="search_code",
        description="Search code across the org.",
        input_schema={
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
            },
        },
    )
    def search_code(arguments: Dict[str, Any]) -> Any:
        query = arguments.get("query", "")
        if not isinstance(query, str) or not query.strip():
            raise JsonRpcError(INVALID_PARAMS, "query is required")
        if mode == "live":
            return {"mode": "live", "query": query, "result": client.search_code(query)}
        return {"mode": "sample", "query": query, "result": SAMPLE_SEARCH,
                "note": "Sample data; set GITHUB_TOKEN and GITHUB_MCP_MODE=live for real code search."}

    # --- FORA-49: QA publisher tools -------------------------------------
    # See `agents/qa/github_publisher.py` for the consumer. These four
    # tools round-trip the publish flow on `qa/test-gen`.

    @tool(
        name="get_pull_request_files",
        description="Get the list of files changed in a pull request, with patch hunks.",
        input_schema={
            "type": "object",
            "required": ["repo", "number"],
            "properties": {
                "repo": {"type": "string"},
                "number": {"type": "integer"},
            },
        },
    )
    def get_pull_request_files(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        number = int(arguments.get("number", 0))
        if mode == "live":
            return {"mode": "live", "repo": repo, "number": number,
                    "files": client.get_pull_request_files(repo, number)}
        # Sample: synthesise a small file list off the fixture PR diff.
        return {"mode": "sample", "repo": repo, "number": number,
                "files": _SAMPLE_PR_FILES.get(number, [])}

    @tool(
        name="create_branch",
        description=("Create a branch pointing at a given SHA. "
                     "Idempotent: if the branch already exists the call returns success."),
        input_schema={
            "type": "object",
            "required": ["repo", "branch", "from_sha"],
            "properties": {
                "repo": {"type": "string"},
                "branch": {"type": "string"},
                "from_sha": {"type": "string"},
            },
        },
    )
    def create_branch(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        branch = arguments.get("branch", "")
        from_sha = arguments.get("from_sha", "")
        if not branch or not from_sha:
            raise JsonRpcError(INVALID_PARAMS,
                               "branch and from_sha are required")
        if mode == "live":
            try:
                res = client.create_branch(repo, branch, from_sha)
            except JsonRpcError as exc:
                # 422 with "Reference already exists" is success on a retry.
                if exc.code == INTERNAL_ERROR and "already" in str(exc):
                    return {"mode": "live", "repo": repo, "branch": branch,
                            "sha": from_sha, "created": False,
                            "note": "branch already existed"}
                raise
            return {"mode": "live", "repo": repo, "branch": branch,
                    "sha": from_sha, "created": True, "ref": res}
        # Sample: idempotent insert.
        bucket = _SAMPLE_BRANCHES.setdefault(repo, {})
        already = branch in bucket
        bucket[branch] = from_sha
        return {"mode": "sample", "repo": repo, "branch": branch,
                "sha": from_sha, "created": not already,
                "note": "Sample data; set GITHUB_MCP_MODE=live to create a real branch."}

    @tool(
        name="create_or_update_file",
        description=("Create or update a single file on a branch. "
                     "Pass `sha` to update an existing file; omit to create."),
        input_schema={
            "type": "object",
            "required": ["repo", "branch", "path", "content", "message"],
            "properties": {
                "repo": {"type": "string"},
                "branch": {"type": "string"},
                "path": {"type": "string"},
                "content": {"type": "string"},
                "message": {"type": "string"},
                "sha": {"type": "string"},
            },
        },
    )
    def create_or_update_file(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        branch = arguments.get("branch", "")
        path = arguments.get("path", "")
        content = arguments.get("content", "")
        message = arguments.get("message", "")
        sha = arguments.get("sha")
        if not branch or not path or not message:
            raise JsonRpcError(INVALID_PARAMS,
                               "branch, path, and message are required")
        if mode == "live":
            res = client.create_or_update_file(repo, branch, path, content,
                                               message, sha=sha)
            return {"mode": "live", "repo": repo, "branch": branch,
                    "path": path, "result": res}
        # Sample: stash the file under (repo, branch) and pretend the
        # SHA is the SHA-1 of the content.
        key = f"{repo}::{branch}"
        _SAMPLE_FILES.setdefault(key, {})[path] = content
        import hashlib as _hl
        fake_sha = _hl.sha1(content.encode("utf-8")).hexdigest()
        return {"mode": "sample", "repo": repo, "branch": branch,
                "path": path, "content_sha": fake_sha, "committed": True,
                "note": "Sample data; set GITHUB_MCP_MODE=live to commit a real file."}

    @tool(
        name="create_pull_request",
        description=("Open a pull request from `head` to `base`. "
                     "Used by the QA publisher to open the follow-up "
                     "`qa/test-gen` PR after tests are committed."),
        input_schema={
            "type": "object",
            "required": ["repo", "head", "base", "title", "body"],
            "properties": {
                "repo": {"type": "string"},
                "head": {"type": "string"},
                "base": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
            },
        },
    )
    def create_pull_request(arguments: Dict[str, Any]) -> Any:
        repo = _repo_full_name(arguments, default_org)
        head = arguments.get("head", "")
        base = arguments.get("base", "main")
        title = arguments.get("title", "")
        body = arguments.get("body", "")
        if not head or not title:
            raise JsonRpcError(INVALID_PARAMS,
                               "head and title are required")
        if mode == "live":
            res = client.create_pull_request(repo, head, base, title, body)
            return {"mode": "live", "repo": repo, "pull_request": res}
        # Sample: record the PR and return a deterministic-looking URL.
        key = f"{repo}::{head}"
        pr = _SAMPLE_QA_PRS.setdefault(key, {
            "number": 99000 + len(_SAMPLE_QA_PRS) + 1,
            "title": title, "body": body, "head": head, "base": base,
        })
        url = f"https://github.com/{repo}/pull/{pr['number']}"
        return {"mode": "sample", "repo": repo, "head": head, "base": base,
                "pull_request": {**pr, "html_url": url, "state": "open"},
                "html_url": url,
                "note": "Sample data; set GITHUB_MCP_MODE=live to open a real PR."}

    for name, fn in [
        ("list_repos", list_repos), ("get_pr", get_pr), ("list_prs", list_prs),
        ("create_pr_comment", create_pr_comment), ("list_issues", list_issues),
        ("create_issue", create_issue), ("search_code", search_code),
        ("get_pull_request_files", get_pull_request_files),
        ("create_branch", create_branch),
        ("create_or_update_file", create_or_update_file),
        ("create_pull_request", create_pull_request),
    ]:
        server.register(name, fn)
    return server


def main() -> None:
    server = make_server()
    server.serve_forever()


if __name__ == "__main__":
    main()
