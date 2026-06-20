"""
Input collectors for the Ideation Agent.

Each collector pulls a structured slice of evidence from one source.
For sources that don't have an MCP yet, we use a deterministic local
synthesizer that returns well-formed sample data with a `mode` of
`sample` so the agent (and reviewers) can always tell where the signal
came from.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any, Dict, List, Optional

from .schemas import InputSignal


# Each collector returns a normalized InputSignal. The shape is
# deliberately small so the synthesizer has consistent inputs.


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def collect_jira(jira_client) -> InputSignal:
    """Pull open issues from Jira across the projects that matter.

    Calls the Jira MCP twice: once for `list_projects` to discover the
    org's projects, and once for `list_issues` to pull the open queue.
    """
    projects = jira_client.call("list_projects")
    project_keys = [p["key"] for p in projects.get("projects", [])]
    issues: List[Dict[str, Any]] = []
    for key in project_keys:
        result = jira_client.call("list_issues", {"jql": f"project={key} status!=Done"})
        issues.extend(result.get("issues", []))
    return InputSignal(
        source="jira",
        fetched_at=_now(),
        mode=projects.get("mode", "sample"),
        items=issues,
        summary=f"{len(projects.get('projects', []))} projects, {len(issues)} open issues",
    )


def collect_github(github_client) -> InputSignal:
    """Pull repos, open PRs, and open issues from GitHub via the MCP.

    Calls three GitHub MCP tools: list_repos, list_prs, list_issues.
    """
    repos = github_client.call("list_repos", {})
    repo_names = [r["name"] for r in repos.get("repos", [])]
    prs: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []
    for name in repo_names:
        prs_resp = github_client.call("list_prs", {"repo": name, "state": "open"})
        prs.extend(p | {"repo": name} for p in prs_resp.get("prs", []))
        issues_resp = github_client.call("list_issues", {"repo": name, "state": "open"})
        issues.extend(i | {"repo": name} for i in issues_resp.get("issues", []))
    return InputSignal(
        source="github",
        fetched_at=_now(),
        mode=repos.get("mode", "sample"),
        items={"repos": repos.get("repos", []),
               "prs": prs,
               "issues": issues},
        summary=f"{len(repo_names)} repos, {len(prs)} open PRs, "
                f"{len(issues)} open issues",
    )


def collect_zendesk() -> InputSignal:
    """Zendesk MCP is priority-2; for now we use a deterministic sample slice.

    Once the Zendesk MCP ships (FORA follow-up), this becomes a real
    client.call() like the GitHub and Jira collectors.
    """
    items = [
        {"id": 4421, "subject": "Card declined but order shows pending",
         "priority": "high", "tags": ["checkout", "false-decline"],
         "created_at": "2026-06-11T09:12:00Z",
         "description": "Customer reports the card was charged but the order is stuck "
                        "in 'pending'. Need clearer state and an auto-recovery path."},
        {"id": 4417, "subject": "EU delivery ETA is off by 2-3 days",
         "priority": "medium", "tags": ["fulfillment", "EU"],
         "created_at": "2026-06-10T14:38:00Z",
         "description": "Warehouse routing for EU uses Haversine distance; "
                        "real road distance gives 2-3 day ETAs."},
    ]
    return InputSignal(source="zendesk", fetched_at=_now(), mode="sample",
                       items=items,
                       summary=f"{len(items)} tickets tagged checkout/fulfillment")


def collect_confluence() -> InputSignal:
    """Confluence MCP is priority-1 but not yet built (FORA backlog)."""
    items = [
        {"id": "FORA-ARCH-3", "title": "Checkout service architecture overview",
         "space": "ENG", "updated": "2026-05-30T12:00:00Z",
         "excerpt": "Checkout is a Python service behind ALB. The payment gateway is "
                    "abstracted behind a `PaymentProvider` interface. The idempotency "
                    "store is Redis with a 24h TTL."},
        {"id": "FORA-ARCH-7", "title": "Warehouse routing: design and constraints",
         "space": "ENG", "updated": "2026-06-02T09:00:00Z",
         "excerpt": "Routers compute a weighted score from capacity, distance, and "
                    "SLA tier. Distance is Haversine; we plan to move to road-network "
                    "distance for the EU region."},
    ]
    return InputSignal(source="confluence", fetched_at=_now(), mode="sample",
                       items=items, summary=f"{len(items)} architecture pages")


def collect_sonarqube() -> InputSignal:
    """SonarQube MCP is priority-1 but not yet built (FORA backlog)."""
    items = [
        {"repo": "checkout-api", "rule": "python:S5754", "severity": "major",
         "file": "services/checkout/src/idempotency.py",
         "message": "Idempotency TTL is hardcoded to 24h. Make this configurable."},
        {"repo": "fulfillment-svc", "rule": "python:S3776", "severity": "minor",
         "file": "services/fulfillment/src/routing.py",
         "message": "Cognitive complexity of weighted_score() is 18; refactor."},
    ]
    return InputSignal(source="sonarqube", fetched_at=_now(), mode="sample",
                       items=items, summary=f"{len(items)} findings across 2 repos")


def collect_market_intel() -> InputSignal:
    """Market Intel is a curated feed maintained by the BA team.

    For v1 it is a hand-curated file the Ideation Agent reads. The
    schema is intentionally simple so future automation (LLM scrapers,
    RSS) can replace this without changing the agent.
    """
    items = [
        {"headline": "EU PSD2 SCA friction cited as #1 checkout abandonment driver",
         "source": "Baymard Q2 2026", "date": "2026-05-15",
         "implication": "Reducing false declines and 3DS redirects has direct revenue "
                        "impact for EU."},
        {"headline": "Same-day delivery now table-stakes in 3 EU metros",
         "source": "Forrester", "date": "2026-04-22",
         "implication": "Warehouse routing must include road-network distance and "
                        "intra-day capacity."},
    ]
    return InputSignal(source="market_intel", fetched_at=_now(), mode="sample",
                       items=items, summary=f"{len(items)} market signals")
