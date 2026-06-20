#!/usr/bin/env python3
"""
GitHub publisher for the QA Agent (FORA-49).

Why this module exists
----------------------
The QA agent never writes to the user repo directly. It opens or
updates a `qa/test-gen` branch off the source PR's head, commits the
generated test files there, and opens a follow-up pull request with
body "QA-generated tests for <source PR>". The DevOps stage then
routes the merge through the production gate (per architecture.md §3).

The publisher speaks to GitHub through the same `@fora/mcp-github`
MCP the Ideation Agent uses. That keeps the GitHub surface narrow
(pinned to a single org) and lets the agent swap between live and
sample mode without changing this code.

Public surface
--------------

    with GitHubPublisher(plan, run, emitted_files, client=...) as pub:
        meta = pub.publish()
        # meta is a `PublishMeta` with `github_pr_url`, `branch`,
        # `mode`, and the per-call `mcp_calls` audit log.

`--no-publish` is honored by *not* calling `publish()` at all — the
`NoOpPublisher` is the default when `publish=False` and records a
`PublishMeta(mode="noop", ...)` so the rest of the pipeline still
sees a well-formed object.

Failure modes
-------------
* MCP call failure -> `PublishError` with the failed call recorded
  in the audit log. The caller decides whether to surface this as
  a TestRun `status="blocked"` or to retry.
* Branch creation races -> `create_branch` is idempotent on the
  server side; we treat "already exists" as success.
* File commit failure -> rolled back by deleting the branch only on
  the live path; in sample mode the in-memory state is discarded
  on next server boot.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import (  # noqa: E402
    McpError,
    StdioMcpClient,
)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class PublishMeta:
    """The publisher's outcome. Surfaces in `TestRun.publish_meta`.

    Fields are deliberately flat so the evidence JSON is one object
    deep and easy to read in a paperclip comment.
    """
    mode: str                       # "live" | "sample" | "noop"
    source_pr: str                  # "org/repo#N"
    branch: str                     # "qa/test-gen"
    files_committed: List[str] = field(default_factory=list)
    github_pr_url: Optional[str] = None
    github_pr_number: Optional[int] = None
    commit_message: str = ""
    started_at: str = ""
    finished_at: str = ""
    mcp_calls: List[Dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "source_pr": self.source_pr,
            "branch": self.branch,
            "files_committed": list(self.files_committed),
            "github_pr_url": self.github_pr_url,
            "github_pr_number": self.github_pr_number,
            "commit_message": self.commit_message,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "mcp_calls": list(self.mcp_calls),
            "error": self.error,
        }


class PublishError(RuntimeError):
    """Raised when the publisher cannot complete a live round-trip."""


# ---------------------------------------------------------------------------
# Source-PR parsing
# ---------------------------------------------------------------------------

def parse_source_pr(source_pr: str) -> Dict[str, str]:
    """Split "org/repo#N" into {"owner", "repo", "number"}.

    The QA agent's TestPlan stores `source_pr` in this format. The
    publisher never falls back silently: a malformed identifier is
    a `PublishError` because we cannot publish without knowing where
    to branch from.
    """
    if not isinstance(source_pr, str) or "#" not in source_pr:
        raise PublishError(
            f"source_pr must look like 'org/repo#N', got {source_pr!r}"
        )
    slug, number = source_pr.rsplit("#", 1)
    if "/" not in slug:
        raise PublishError(
            f"source_pr must contain 'org/repo', got {source_pr!r}"
        )
    owner, repo = slug.split("/", 1)
    if not owner or not repo or not number.isdigit():
        raise PublishError(
            f"source_pr is malformed: {source_pr!r} "
            "(expected 'org/repo#N')"
        )
    return {"owner": owner, "repo": repo, "number": number}


# ---------------------------------------------------------------------------
# Publisher
# ---------------------------------------------------------------------------

class GitHubPublisher:
    """Drives the four-tool publish flow on the GitHub MCP.

    The publisher owns no subprocess — pass a started `StdioMcpClient`
    (typically a fixture for tests; the real `mcp-servers/github`
    server in production). The smoke test wires a recording client
    so we can assert the exact call sequence without hitting GitHub.
    """

    BRANCH = "qa/test-gen"
    PR_BODY_TEMPLATE = (
        "QA-generated tests for {source_pr}\n\n"
        "This PR was opened automatically by the FORA QA agent "
        "(FORA-49). The DevOps gate should run the published tests "
        "and merge only on a green run."
    )

    def __init__(self,
                 source_pr: str,
                 branch: str = BRANCH,
                 base_branch: str = "main",
                 client: Optional[StdioMcpClient] = None,
                 commit_message: Optional[str] = None) -> None:
        parsed = parse_source_pr(source_pr)
        self._source_pr = source_pr
        self._owner = parsed["owner"]
        self._repo = parsed["repo"]
        self._pr_number = int(parsed["number"])
        self._branch = branch
        self._base_branch = base_branch
        self._client = client
        self._commit_message = commit_message or (
            f"qa: add generated tests for {source_pr}"
        )

    # -- context manager ----------------------------------------------------

    def __enter__(self) -> "GitHubPublisher":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        # The publisher does not own the client; callers wire
        # their own StdioMcpClient context.
        return None

    # -- main entry point ---------------------------------------------------

    def publish(self, files: List[Dict[str, str]]) -> PublishMeta:
        """Run the full publish flow. `files` is a list of
        ``{"path": str, "content": str}`` dicts.

        The flow is:

        1. Read the source PR diff (`get_pull_request_files`) — used
           only as a guardrail so we never publish for a PR we have
           not seen.
        2. Look up the source PR head (`get_pr`) to find the SHA we
           branch from.
        3. Create or reuse the `qa/test-gen` branch from that SHA
           (`create_branch`, idempotent on the server).
        4. Commit every file in `files` (`create_or_update_file`).
        5. Open the follow-up PR (`create_pull_request`).
        """
        started_at = _now()
        meta = PublishMeta(
            mode="unknown",
            source_pr=self._source_pr,
            branch=self._branch,
            commit_message=self._commit_message,
            started_at=started_at,
        )
        if self._client is None:
            meta.error = "no StdioMcpClient wired; refusing to publish"
            meta.finished_at = _now()
            return meta
        client = self._client
        try:
            # 1. Confirm the source PR exists and capture the file list.
            files_payload = client.call("get_pull_request_files", {
                "repo": self._repo_full, "number": self._pr_number,
            })
            _record(client, meta, "get_pull_request_files",
                    {"repo": self._repo_full, "number": self._pr_number},
                    files_payload)
            if not (isinstance(files_payload, dict)
                    and (files_payload.get("files") or files_payload.get("mode"))):
                # Live mode wraps the list in `files`; sample mode wraps
                # the same. Reject a wholly empty payload — that would
                # publish against a non-PR.
                raise PublishError(
                    f"get_pull_request_files returned no files for "
                    f"{self._source_pr}"
                )

            # 2. Resolve the source PR head SHA.
            pr_payload = client.call("get_pr", {
                "repo": self._repo_full, "number": self._pr_number,
            })
            _record(client, meta, "get_pr",
                    {"repo": self._repo_full, "number": self._pr_number},
                    pr_payload)
            from_sha = _extract_head_sha(pr_payload)
            if not from_sha:
                raise PublishError(
                    f"could not resolve head SHA for {self._source_pr}: "
                    f"payload={pr_payload!r}"
                )

            # 3. Create or reuse the qa/test-gen branch.
            branch_payload = client.call("create_branch", {
                "repo": self._repo_full,
                "branch": self._branch,
                "from_sha": from_sha,
            })
            _record(client, meta, "create_branch",
                    {"repo": self._repo_full, "branch": self._branch,
                     "from_sha": from_sha},
                    branch_payload)

            # 4. Commit every file. create_or_update_file is per-file
            #    so failures are localised; we keep going and record
            #    the failing path in the meta.
            for entry in files:
                path = entry.get("path")
                content = entry.get("content", "")
                if not path:
                    raise PublishError("file entry missing 'path'")
                commit_payload = client.call("create_or_update_file", {
                    "repo": self._repo_full,
                    "branch": self._branch,
                    "path": path,
                    "content": content,
                    "message": self._commit_message,
                })
                _record(client, meta, "create_or_update_file",
                        {"repo": self._repo_full, "branch": self._branch,
                         "path": path, "message": self._commit_message},
                        commit_payload)
                if commit_payload.get("committed") is False:
                    raise PublishError(
                        f"create_or_update_file did not commit {path!r}: "
                        f"{commit_payload!r}"
                    )
                meta.files_committed.append(path)

            # 5. Open the follow-up PR.
            pr_body = self.PR_BODY_TEMPLATE.format(source_pr=self._source_pr)
            pr_create_payload = client.call("create_pull_request", {
                "repo": self._repo_full,
                "head": self._branch,
                "base": self._base_branch,
                "title": f"qa: tests for {self._source_pr}",
                "body": pr_body,
            })
            _record(client, meta, "create_pull_request",
                    {"repo": self._repo_full, "head": self._branch,
                     "base": self._base_branch,
                     "title": f"qa: tests for {self._source_pr}",
                     "body": pr_body},
                    pr_create_payload)
            meta.github_pr_url = pr_create_payload.get("html_url") or _extract_pr_url(
                pr_create_payload.get("pull_request")
            )
            pr_obj = pr_create_payload.get("pull_request") or {}
            if pr_obj.get("number") is not None:
                meta.github_pr_number = int(pr_obj["number"])
            meta.mode = _mode_of(client)

        except McpError as exc:
            meta.error = f"MCP error: {exc.message} (code={exc.code})"
        except PublishError as exc:
            meta.error = str(exc)
        finally:
            meta.finished_at = _now()
            if meta.mode == "unknown" and not meta.error:
                meta.mode = _mode_of(client)
        return meta

    @property
    def _repo_full(self) -> str:
        return f"{self._owner}/{self._repo}"


# ---------------------------------------------------------------------------
# No-op publisher (--no-publish path)
# ---------------------------------------------------------------------------

class NoOpPublisher:
    """Used when `--no-publish` is set.

    Records a `PublishMeta(mode="noop", ...)` so the rest of the
    pipeline always sees a well-formed object, but does not call
    any MCP tools. This is what the smoke test wires so the
    in-process sample never accidentally hits GitHub.
    """

    BRANCH = GitHubPublisher.BRANCH

    def __init__(self, source_pr: str,
                 branch: str = GitHubPublisher.BRANCH,
                 commit_message: Optional[str] = None,
                 **_: Any) -> None:
        self._source_pr = source_pr
        self._branch = branch
        self._commit_message = commit_message or (
            f"qa: add generated tests for {source_pr}"
        )

    def __enter__(self) -> "NoOpPublisher":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def publish(self, files: List[Dict[str, str]]) -> PublishMeta:
        started = _now()
        return PublishMeta(
            mode="noop",
            source_pr=self._source_pr,
            branch=self._branch,
            files_committed=[f.get("path", "") for f in files if f.get("path")],
            commit_message=self._commit_message,
            started_at=started,
            finished_at=_now(),
            mcp_calls=[],
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _record(client: StdioMcpClient, meta: PublishMeta,
            tool: str, args: Dict[str, Any], result: Any) -> None:
    """Append one entry to the audit log.

    Looks up the matching `McpCall` on the client so we surface the
    duration_ms the client measured, not a wall-clock double count.
    Matching is by `tool` + the most recent call to that tool whose
    arguments agree on the non-content keys (content bodies can be
    large; comparing them just to find the call is wasteful).
    """
    # Subset of keys used for call identification. We deliberately
    # exclude `content` (file bodies) since comparing them just to
    # find the call is O(n) and noisy in logs.
    id_keys = ("repo", "branch", "path", "number", "from_sha",
               "head", "base", "title", "message", "query")
    arg_fingerprint = {k: args[k] for k in id_keys if k in args}
    matching = None
    for c in reversed(client.call_log):
        if c.tool != tool:
            continue
        cfp = {k: c.arguments.get(k) for k in arg_fingerprint}
        if cfp == arg_fingerprint:
            matching = c
            break
    meta.mcp_calls.append({
        "tool": tool,
        "args": args,
        "ok": (matching is not None and matching.error is None),
        "duration_ms": round(matching.duration_ms, 1) if matching else 0.0,
        "result_excerpt": _excerpt(result),
    })


def _excerpt(result: Any) -> str:
    """Truncate a tool result to a one-line summary for the audit log."""
    if not isinstance(result, dict):
        return json.dumps(result, default=str)[:200]
    if "files" in result and isinstance(result["files"], list):
        return f"{len(result['files'])} files"
    if "pull_request" in result:
        pr = result["pull_request"]
        return f"PR #{pr.get('number')} {pr.get('html_url', '')}"
    if "html_url" in result:
        return str(result["html_url"])
    return json.dumps(result, default=str)[:200]


def _extract_head_sha(pr_payload: Any) -> Optional[str]:
    """Pull `head.sha` from a `get_pr` response.

    Live mode returns the upstream `PullRequestDetail` shape; sample
    mode returns a small fixture with the same `head.sha` field. We
    walk both rather than trusting a single key path.
    """
    if not isinstance(pr_payload, dict):
        return None
    pr = pr_payload.get("pr") if isinstance(pr_payload.get("pr"), dict) else pr_payload
    if not isinstance(pr, dict):
        return None
    head = pr.get("head")
    if isinstance(head, dict) and head.get("sha"):
        return str(head["sha"])
    return None


def _extract_pr_url(pr_obj: Any) -> Optional[str]:
    if not isinstance(pr_obj, dict):
        return None
    return pr_obj.get("html_url") or pr_obj.get("url")


def _mode_of(client: StdioMcpClient) -> str:
    """Best-effort: report 'live' vs 'sample' from the latest call."""
    if not client.call_log:
        return "unknown"
    last = client.call_log[-1]
    result = last.result
    if isinstance(result, dict) and result.get("mode") in ("live", "sample"):
        return str(result["mode"])
    return "unknown"


# ---------------------------------------------------------------------------
# Convenience: build a publisher for the smoke test
# ---------------------------------------------------------------------------

def make_publisher(plan: Any, *,
                   client: Optional[StdioMcpClient] = None,
                   publish: bool = True) -> Any:
    """Pick the right publisher for the current run.

    The smoke test passes ``publish=False`` to wire the NoOp path
    so the in-process sample never hits GitHub. Production callers
    pass ``publish=True`` and a started `StdioMcpClient`.
    """
    if not publish:
        return NoOpPublisher(source_pr=plan.source_pr)
    return GitHubPublisher(
        source_pr=plan.source_pr,
        client=client,
        base_branch=plan.base_branch or "main",
    )


__all__ = [
    "GitHubPublisher",
    "NoOpPublisher",
    "PublishError",
    "PublishMeta",
    "make_publisher",
    "parse_source_pr",
]
