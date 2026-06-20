#!/usr/bin/env python3
"""
Jira MCP server (priority-1 MCP, FORA-8).

Reuses the layout of the GitHub MCP (FORA-4): same JSON-RPC 2.0 stdio
transport, same sample/live mode split, same client class. The only
genuine differences from the GitHub MCP are listed at the bottom of
this file and in agents/jira_mcp/README.md.

Tools:
    list_projects, list_issues, get_issue, create_issue, update_issue,
    add_comment, transition_issue.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from agents._shared.jsonrpc import (  # noqa: E402
    AUTH_MISSING,
    INVALID_PARAMS,
    INTERNAL_ERROR,
    JsonRpcError,
    StdioJsonRpcServer,
    tool,
)

DEFAULT_SITE = os.environ.get("ATLASSIAN_SITE", "fora.atlassian.net")
DEFAULT_MODE = "live" if os.environ.get("ATLASSIAN_TOKEN") else "sample"

# Allowed state transitions in our sample data. Real Jira projects
# define their own workflows; this is a sensible default for FORA's
# SDLC pipeline (To Do -> In Progress -> In Review -> Done).
SAMPLE_TRANSITIONS = {
    "To Do": ["In Progress"],
    "In Progress": ["In Review", "To Do"],
    "In Review": ["Done", "In Progress"],
    "Done": [],
}


SAMPLE_PROJECTS = [
    {"key": "FORA", "name": "FORA Platform", "projectTypeKey": "software",
     "lead": {"displayName": "CTO"}, "issueTypes": [{"name": "Task"}, {"name": "Bug"},
     {"name": "Story"}, {"name": "Epic"}]},
    {"key": "CHECK", "name": "Checkout & Payments", "projectTypeKey": "software",
     "lead": {"displayName": "Alice"}, "issueTypes": [{"name": "Task"}, {"name": "Bug"},
     {"name": "Story"}]},
    {"key": "FUL", "name": "Fulfillment", "projectTypeKey": "software",
     "lead": {"displayName": "Bo"}, "issueTypes": [{"name": "Task"}, {"name": "Bug"},
     {"name": "Story"}]},
]

SAMPLE_ISSUES = [
    {"key": "FORA-6", "fields": {
        "summary": "Implement Stage 1 Ideation Agent (first concrete sub-agent)",
        "status": {"name": "In Progress"},
        "priority": {"name": "High"},
        "assignee": {"displayName": "CTO"},
        "labels": ["agent", "ideation", "stage-1"],
        "description": "Build the first end-to-end sub-agent of the SDLC pipeline.",
        "created": "2026-06-16T18:11:05.000+0000",
        "updated": "2026-06-16T18:11:07.000+0000",
    }},
    {"key": "CHECK-240", "fields": {
        "summary": "Idempotency window too short for retry-heavy customers",
        "status": {"name": "Open"},
        "priority": {"name": "High"},
        "assignee": {"displayName": "Alice"},
        "labels": ["reliability", "checkout"],
        "description": "0.4% of checkout retries land after the 24h idempotency window. "
                       "Need a longer TTL or two-phase commit.",
        "created": "2026-06-09T08:00:00.000+0000",
        "updated": "2026-06-15T12:00:00.000+0000",
    }},
    {"key": "CHECK-238", "fields": {
        "summary": "Fraud rules over-block EU debit cards",
        "status": {"name": "Open"},
        "priority": {"name": "High"},
        "assignee": {"displayName": "Alice"},
        "labels": ["fraud", "EU"],
        "description": "False-positive rate 3.1% on EU debit cards. Need region tuning.",
        "created": "2026-06-08T15:30:00.000+0000",
        "updated": "2026-06-14T09:00:00.000+0000",
    }},
    {"key": "FUL-91", "fields": {
        "summary": "Road-network distance for EU warehouse routing",
        "status": {"name": "In Progress"},
        "priority": {"name": "Medium"},
        "assignee": {"displayName": "Bo"},
        "labels": ["enhancement", "fulfillment"],
        "description": "Replace Haversine with road-network distance in EU region.",
        "created": "2026-06-04T11:00:00.000+0000",
        "updated": "2026-06-15T10:00:00.000+0000",
    }},
]

SAMPLE_COMMENTS = [
    {"id": "10001", "body": "Confirmed with finance: 0.4% dup order rate is unacceptable.",
     "author": {"displayName": "PM"}, "created": "2026-06-10T10:00:00.000+0000"},
]


# ---------------------------------------------------------------------------
# Live REST client
# ---------------------------------------------------------------------------

class JiraClient:
    """Thin wrapper over Jira Cloud REST v3."""

    def __init__(self, site: str, email: str, token: str) -> None:
        self._site = site
        self._auth_header = "Basic " + base64.b64encode(
            f"{email}:{token}".encode("utf-8")
        ).decode("ascii")
        # The cloudId is resolved lazily on first call; many sites redirect.
        self._cloud_id: Optional[str] = None

    def _url(self, path: str) -> str:
        if self._cloud_id:
            return f"https://api.atlassian.com/ex/jira/{self._cloud_id}/rest/api/3{path}"
        return f"https://{self._site}/rest/api/3{path}"

    def _request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Any:
        data = None
        headers = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "User-Agent": "fora-jira-mcp/0.1.0",
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self._url(path), data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = resp.read()
                if not payload:
                    return {}
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise JsonRpcError(AUTH_MISSING, f"jira auth failed: HTTP {exc.code}")
            raise JsonRpcError(INTERNAL_ERROR, f"jira upstream HTTP {exc.code}: {exc.reason}")

    def list_projects(self) -> List[Dict[str, Any]]:
        return self._request("/project/search?maxResults=50").get("values", [])

    def list_issues(self, jql: str) -> List[Dict[str, Any]]:
        body = {"jql": jql, "maxResults": 50, "fields": ["summary", "status",
                                                          "priority", "assignee",
                                                          "labels", "description",
                                                          "created", "updated"]}
        # POST /search keeps long JQL out of URLs.
        return self._request("/search", method="POST", body=body).get("issues", [])

    def get_issue(self, key: str) -> Dict[str, Any]:
        return self._request(f"/issue/{key}?fields=*all")

    def create_issue(self, project: str, summary: str, body: str,
                     issue_type: str, labels: Optional[List[str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "fields": {
                "project": {"key": project},
                "summary": summary,
                "description": {"type": "doc", "version": 1,
                                "content": [{"type": "paragraph",
                                             "content": [{"type": "text", "text": body}]}]},
                "issuetype": {"name": issue_type},
            },
        }
        if labels:
            payload["fields"]["labels"] = labels
        return self._request("/issue", method="POST", body=payload)

    def update_issue(self, key: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        return self._request(f"/issue/{key}", method="PUT", body={"fields": fields})

    def add_comment(self, key: str, body: str) -> Dict[str, Any]:
        payload = {"body": {"type": "doc", "version": 1,
                            "content": [{"type": "paragraph",
                                         "content": [{"type": "text", "text": body}]}]}}
        return self._request(f"/issue/{key}/comment", method="POST", body=payload)

    def transition_issue(self, key: str, transition_name: str) -> Dict[str, Any]:
        # Resolve transition id by name. Jira uses numeric ids that differ
        # per project; the only stable client-side identifier is the name.
        transitions = self._request(f"/issue/{key}/transitions").get("transitions", [])
        match = next((t for t in transitions if t.get("name") == transition_name), None)
        if not match:
            available = sorted(t.get("name", "?") for t in transitions)
            raise JsonRpcError(INVALID_PARAMS,
                               f"transition '{transition_name}' not available for {key}",
                               {"available": available})
        return self._request(f"/issue/{key}/transitions", method="POST",
                             body={"transition": {"id": match["id"]}})


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def make_server() -> StdioJsonRpcServer:
    mode = os.environ.get("JIRA_MCP_MODE", DEFAULT_MODE)
    site = os.environ.get("ATLASSIAN_SITE", DEFAULT_SITE)
    email = os.environ.get("ATLASSIAN_EMAIL", "")
    token = os.environ.get("ATLASSIAN_TOKEN", "")
    live = mode == "live"
    client: Optional[JiraClient] = None
    if live:
        if not email or not token:
            sys.stderr.write("[jira_mcp] JIRA_MCP_MODE=live but missing ATLASSIAN_EMAIL/"
                             "ATLASSIAN_TOKEN; using sample data\n")
            mode = "sample"
        else:
            client = JiraClient(site=site, email=email, token=token)

    server = StdioJsonRpcServer(name="jira-mcp", version="0.1.0")

    @tool(
        name="list_projects",
        description="List Jira projects visible to the caller.",
        input_schema={"type": "object", "properties": {}},
    )
    def list_projects(arguments: Dict[str, Any]) -> Any:
        if mode == "live":
            return {"mode": "live", "site": site, "projects": client.list_projects()}
        return {"mode": "sample", "site": site, "projects": SAMPLE_PROJECTS,
                "note": "Sample data; set ATLASSIAN_TOKEN and JIRA_MCP_MODE=live for real projects."}

    @tool(
        name="list_issues",
        description="List issues via a JQL query. Use a small, narrow JQL to stay under the "
                    "1000-issue cap.",
        input_schema={
            "type": "object",
            "required": ["jql"],
            "properties": {"jql": {"type": "string"}},
        },
    )
    def list_issues(arguments: Dict[str, Any]) -> Any:
        jql = arguments.get("jql", "")
        if not isinstance(jql, str) or not jql.strip():
            raise JsonRpcError(INVALID_PARAMS, "jql is required")
        if mode == "live":
            return {"mode": "live", "jql": jql, "issues": client.list_issues(jql)}
        # Naive JQL matcher for the sample fixture. Supports project=KEY and status=NAME.
        issues = SAMPLE_ISSUES
        if "project=" in jql:
            for token in jql.split():
                if token.startswith("project="):
                    project_key = token.split("=", 1)[1].strip("'\"")
                    issues = [i for i in issues if i["key"].startswith(project_key + "-")]
        if "status=" in jql:
            for token in jql.split():
                if token.startswith("status="):
                    name = token.split("=", 1)[1].strip("'\"")
                    issues = [i for i in issues if i["fields"]["status"]["name"] == name]
        return {"mode": "sample", "jql": jql, "issues": issues,
                "note": "Sample data; set ATLASSIAN_TOKEN and JIRA_MCP_MODE=live for real issues."}

    @tool(
        name="get_issue",
        description="Fetch a single issue by key, e.g. FORA-6.",
        input_schema={
            "type": "object",
            "required": ["key"],
            "properties": {"key": {"type": "string"}},
        },
    )
    def get_issue(arguments: Dict[str, Any]) -> Any:
        key = arguments.get("key", "")
        if not isinstance(key, str) or not key.strip():
            raise JsonRpcError(INVALID_PARAMS, "key is required")
        if mode == "live":
            return {"mode": "live", "key": key, "issue": client.get_issue(key)}
        for issue in SAMPLE_ISSUES:
            if issue["key"] == key:
                return {"mode": "sample", "key": key, "issue": issue}
        raise JsonRpcError(INVALID_PARAMS, f"no sample issue {key} in fixture")

    @tool(
        name="create_issue",
        description="Create a new issue in a project.",
        input_schema={
            "type": "object",
            "required": ["project", "summary", "issue_type"],
            "properties": {
                "project": {"type": "string"},
                "summary": {"type": "string"},
                "body": {"type": "string"},
                "issue_type": {"type": "string", "default": "Task"},
                "labels": {"type": "array", "items": {"type": "string"}},
            },
        },
    )
    def create_issue(arguments: Dict[str, Any]) -> Any:
        project = arguments.get("project", "")
        summary = arguments.get("summary", "")
        body = arguments.get("body", "")
        issue_type = arguments.get("issue_type", "Task")
        labels = arguments.get("labels") or []
        if not project.strip() or not summary.strip():
            raise JsonRpcError(INVALID_PARAMS, "project and summary are required")
        if mode == "live":
            return {"mode": "live", "issue": client.create_issue(project, summary, body,
                                                                 issue_type, labels)}
        return {"mode": "sample",
                "issue": {"key": f"{project}-999", "fields": {
                    "summary": summary, "description": body,
                    "status": {"name": "To Do"},
                    "priority": {"name": "Medium"},
                    "assignee": None,
                    "labels": labels,
                    "issuetype": {"name": issue_type},
                    "created": "2026-06-16T18:00:00.000+0000",
                    "updated": "2026-06-16T18:00:00.000+0000",
                }},
                "note": "Sample data; set ATLASSIAN_TOKEN and JIRA_MCP_MODE=live to create a real issue."}

    @tool(
        name="update_issue",
        description="Update issue fields (priority, labels, assignee, etc.).",
        input_schema={
            "type": "object",
            "required": ["key", "fields"],
            "properties": {
                "key": {"type": "string"},
                "fields": {"type": "object"},
            },
        },
    )
    def update_issue(arguments: Dict[str, Any]) -> Any:
        key = arguments.get("key", "")
        fields = arguments.get("fields") or {}
        if not isinstance(key, str) or not key.strip():
            raise JsonRpcError(INVALID_PARAMS, "key is required")
        if not isinstance(fields, dict) or not fields:
            raise JsonRpcError(INVALID_PARAMS, "fields must be a non-empty object")
        if mode == "live":
            client.update_issue(key, fields)
            return {"mode": "live", "key": key, "updated": True}
        # Sample mode: mutate the in-memory copy.
        for issue in SAMPLE_ISSUES:
            if issue["key"] == key:
                issue["fields"].update(fields)
                return {"mode": "sample", "key": key, "updated": True,
                        "issue": issue}
        raise JsonRpcError(INVALID_PARAMS, f"no sample issue {key} in fixture")

    @tool(
        name="add_comment",
        description="Add a comment to an issue.",
        input_schema={
            "type": "object",
            "required": ["key", "body"],
            "properties": {
                "key": {"type": "string"},
                "body": {"type": "string"},
            },
        },
    )
    def add_comment(arguments: Dict[str, Any]) -> Any:
        key = arguments.get("key", "")
        body = arguments.get("body", "")
        if not isinstance(key, str) or not key.strip():
            raise JsonRpcError(INVALID_PARAMS, "key is required")
        if not isinstance(body, str) or not body.strip():
            raise JsonRpcError(INVALID_PARAMS, "body is required")
        if mode == "live":
            return {"mode": "live", "key": key, "comment": client.add_comment(key, body)}
        return {"mode": "sample", "key": key,
                "comment": {"id": "10099", "body": body,
                            "author": {"displayName": "CTO Agent"},
                            "created": "2026-06-16T18:00:00.000+0000"},
                "note": "Sample data; set ATLASSIAN_TOKEN and JIRA_MCP_MODE=live to post a real comment."}

    @tool(
        name="transition_issue",
        description="Move an issue through its workflow by transition name (e.g. 'In Review').",
        input_schema={
            "type": "object",
            "required": ["key", "transition"],
            "properties": {
                "key": {"type": "string"},
                "transition": {"type": "string"},
            },
        },
    )
    def transition_issue(arguments: Dict[str, Any]) -> Any:
        key = arguments.get("key", "")
        transition = arguments.get("transition", "")
        if not isinstance(key, str) or not key.strip():
            raise JsonRpcError(INVALID_PARAMS, "key is required")
        if not isinstance(transition, str) or not transition.strip():
            raise JsonRpcError(INVALID_PARAMS, "transition is required")
        if mode == "live":
            client.transition_issue(key, transition)
            return {"mode": "live", "key": key, "transition": transition, "applied": True}
        # Sample mode: enforce SAMPLE_TRANSITIONS.
        for issue in SAMPLE_ISSUES:
            if issue["key"] == key:
                current = issue["fields"]["status"]["name"]
                allowed = SAMPLE_TRANSITIONS.get(current, [])
                if transition not in allowed:
                    raise JsonRpcError(INVALID_PARAMS,
                                       f"cannot transition {key} from '{current}' "
                                       f"to '{transition}'",
                                       {"current": current, "allowed": allowed})
                issue["fields"]["status"] = {"name": transition}
                return {"mode": "sample", "key": key, "transition": transition,
                        "from": current, "to": transition, "applied": True,
                        "issue": issue}
        raise JsonRpcError(INVALID_PARAMS, f"no sample issue {key} in fixture")

    for name, fn in [
        ("list_projects", list_projects), ("list_issues", list_issues),
        ("get_issue", get_issue), ("create_issue", create_issue),
        ("update_issue", update_issue), ("add_comment", add_comment),
        ("transition_issue", transition_issue),
    ]:
        server.register(name, fn)
    return server


def main() -> None:
    server = make_server()
    server.serve_forever()


if __name__ == "__main__":
    main()
