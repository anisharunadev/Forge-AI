#!/usr/bin/env python3
"""
Integration test for the QA GitHub publisher (FORA-49).

This test drives the publisher against the *real* GitHub MCP
server in `GITHUB_MCP_MODE=sample` so the four publish tools
round-trip end-to-end without ever hitting api.github.com. The
sample mode is honest: the server records branches, committed
files, and opened PRs in memory and returns deterministic-looking
URLs the test can assert on.

Acceptance contract:

    1. The publisher calls the four tools in order:
       get_pull_request_files, get_pr, create_branch,
       create_or_update_file (per file), create_pull_request.
    2. The returned `PublishMeta` carries the sample-mode URL and
       the list of files it committed.
    3. The agent, when wired with `publish=True`, surfaces the
       same `publish_meta` on the result and on the TestRun
       payload — so the evidence JSON carries `github_pr_url`.

The `--no-publish` smoke path stays a no-op (existing
`agents/qa/smoke_test.py` covers that).

Run:
    python3 agents/qa/publisher_integration_test.py
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import StdioMcpClient  # noqa: E402
from agents.qa.agent import QaAgent  # noqa: E402
from agents.qa.gate import RecordingRunGate, RunGateDecision  # noqa: E402
from agents.qa.github_publisher import (  # noqa: E402
    GitHubPublisher,
    NoOpPublisher,
    PublishError,
    parse_source_pr,
)
from agents.qa.schemas import (  # noqa: E402
    SCHEMA_VERSION,
    TestPlan,
    TierPlan,
)


# Use a fixture PR the sample server knows about (SAMPLE_PRS #481).
# `commit_sha` is the v1 stub — the publisher only needs a valid
# 40-char hex string; the real PR head is fetched live from the
# sample `get_pr` response.
SOURCE_PR = "fora-labs/checkout-api#481"
_COMMIT_SHA = "3" * 40


def _build_plan() -> TestPlan:
    return TestPlan(
        schema_version=SCHEMA_VERSION,
        plan_id="tplan-pub-int",
        run_id="run-pub-int",
        contract_id="hnd-pub-int",
        source_pr=SOURCE_PR,
        branch="qa/test-gen",
        commit_sha=_COMMIT_SHA,
        base_branch="main",
        target_branch="main",
        tiers=[
            TierPlan(tier="unit", framework="pytest",
                     command="pytest -q tests/unit",
                     selection_rule="every change touching business logic"),
        ],
    )


def _emitted_test_files(out_dir: str) -> list:
    """Write two tiny skeleton files into out_dir; return their paths."""
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for name, body in [
        ("test_unit_preauth.py",
         "\"\"\"v1 unit skeleton for preauth.\nqa/test-gen via FORA-49\"\"\"\n"
         "def test_preauth():\n    assert True\n"),
        ("test_unit_idempotency.py",
         "\"\"\"v1 unit skeleton for idempotency.\"\"\"\n"
         "def test_idempotency():\n    assert True\n"),
    ]:
        p = os.path.join(out_dir, name)
        with open(p, "w", encoding="utf-8") as fp:
            fp.write(body)
        paths.append(p)
    return paths


def _make_sample_client() -> StdioMcpClient:
    """Spin up the real github_mcp server in sample mode."""
    env = os.environ.copy()
    env["GITHUB_MCP_MODE"] = "sample"
    env.pop("GITHUB_TOKEN", None)
    server_cmd = [sys.executable, "-m", "agents.github_mcp.server"]
    return StdioMcpClient("github", server_cmd, env=env, cwd=ROOT)


def main() -> int:
    print("=" * 72)
    print("QA GitHub Publisher — integration test (FORA-49)")
    print("=" * 72)
    failures: list = []

    # --- parse_source_pr sanity -------------------------------------------
    parsed = parse_source_pr(SOURCE_PR)
    if parsed != {"owner": "fora-labs", "repo": "checkout-api", "number": "481"}:
        failures.append(f"parse_source_pr returned {parsed!r}")
    else:
        print(f"  parse_source_pr: {SOURCE_PR} -> {parsed}")

    # --- path 1: --no-publish / NoOpPublisher ----------------------------
    print("\n[1] NoOp publisher — --no-publish path")
    noop = NoOpPublisher(source_pr=SOURCE_PR)
    with noop:
        meta = noop.publish([
            {"path": "tests/test_unit_preauth.py", "content": "x"},
        ])
    if meta.mode != "noop":
        failures.append(f"noop mode={meta.mode!r}, expected 'noop'")
    if meta.github_pr_url is not None:
        failures.append(f"noop github_pr_url={meta.github_pr_url!r}, expected None")
    if meta.files_committed != ["tests/test_unit_preauth.py"]:
        failures.append(f"noop files_committed={meta.files_committed!r}")
    if meta.mcp_calls:
        failures.append(f"noop should record 0 mcp_calls, got {len(meta.mcp_calls)}")
    else:
        print(f"  mode={meta.mode}  files_committed={meta.files_committed}  "
              f"github_pr_url={meta.github_pr_url}")

    # --- path 2: live publish flow against the sample MCP server ---------
    print("\n[2] Live publish flow — sample MCP server, real StdioMcpClient")
    with _make_sample_client() as client:
        tools = client.list_tools()
        tool_names = sorted(t["name"] for t in tools)
        expected_tools = sorted([
            "list_repos", "get_pr", "list_prs", "create_pr_comment",
            "list_issues", "create_issue", "search_code",
            "get_pull_request_files", "create_branch",
            "create_or_update_file", "create_pull_request",
        ])
        if tool_names != expected_tools:
            failures.append(f"tool list mismatch: got {tool_names}, expected {expected_tools}")
        else:
            print(f"  tools/list: {len(tool_names)} tools (publisher tools present)")

        publisher = GitHubPublisher(
            source_pr=SOURCE_PR,
            client=client,
            base_branch="main",
        )
        import tempfile
        with tempfile.TemporaryDirectory() as out_dir:
            files = _emitted_test_files(out_dir)
            with publisher:
                meta = publisher.publish([
                    {"path": p, "content": open(p, "r", encoding="utf-8").read()}
                    for p in files
                ])

    if meta.error:
        failures.append(f"publish error: {meta.error}")
    if meta.mode != "sample":
        failures.append(f"live flow mode={meta.mode!r}, expected 'sample'")
    expected_call_order = [
        "get_pull_request_files", "get_pr", "create_branch",
        "create_or_update_file", "create_or_update_file",
        "create_pull_request",
    ]
    actual_call_order = [c["tool"] for c in meta.mcp_calls]
    if actual_call_order != expected_call_order:
        failures.append(
            f"call order mismatch: got {actual_call_order}, "
            f"expected {expected_call_order}"
        )
    if len(meta.files_committed) != 2:
        failures.append(
            f"files_committed={meta.files_committed!r}, expected 2 entries"
        )
    if not meta.github_pr_url or "github.com/fora-labs/checkout-api/pull/" not in meta.github_pr_url:
        failures.append(
            f"github_pr_url={meta.github_pr_url!r} did not match the expected sample URL"
        )
    if meta.github_pr_number is None:
        failures.append("github_pr_number is None on the sample publish path")
    if not meta.started_at or not meta.finished_at:
        failures.append("publish_meta is missing started_at/finished_at")
    if not all(c.get("duration_ms", 0) >= 0 for c in meta.mcp_calls):
        failures.append("one or more mcp_calls has a negative duration_ms")
    print(f"  calls: {len(meta.mcp_calls)}")
    for c in meta.mcp_calls:
        print(f"    {c['tool']:24s} {c['duration_ms']:6.1f}ms  "
              f"ok={c['ok']}  -> {c['result_excerpt']}")
    print(f"  github_pr_url: {meta.github_pr_url}")
    print(f"  files_committed: {meta.files_committed}")

    # --- path 3: full agent run with publish=True wires the meta --------
    print("\n[3] QaAgent(publish=True) wires publish_meta into the result")
    import tempfile
    with tempfile.TemporaryDirectory() as out_dir:
        plan = _build_plan()
        gate = RecordingRunGate(RunGateDecision(
            approved=True, reviewer="sec-lead",
            reason="publish path smoke",
        ))
        with _make_sample_client() as client:
            agent = QaAgent(
                out_dir=out_dir, run_gate=gate,
                github_client=client, publish=True,
            )
            result = agent.run(plan)
        if result.publish_meta is None:
            failures.append("QaAgent(publish=True) did not surface publish_meta")
        elif result.publish_meta.get("mode") != "sample":
            failures.append(
                f"QaAgent(publish=True) publish_meta.mode="
                f"{result.publish_meta.get('mode')!r}, expected 'sample'"
            )
        elif not result.publish_meta.get("github_pr_url"):
            failures.append(
                "QaAgent(publish=True) publish_meta.github_pr_url is empty"
            )
        else:
            print(f"  result.publish_meta.mode: {result.publish_meta['mode']}")
            print(f"  result.publish_meta.github_pr_url: {result.publish_meta['github_pr_url']}")
        if not result.test_run or "publish_meta" not in result.test_run:
            failures.append("QaAgent(publish=True) did not include publish_meta on test_run")
        elif not (result.test_run.get("publish_meta") or {}).get("github_pr_url"):
            failures.append(
                "QaAgent(publish=True) test_run.publish_meta.github_pr_url is empty"
            )
        else:
            url = result.test_run["publish_meta"].get("github_pr_url")
            print(f"  test_run.publish_meta.github_pr_url: {url}")

    # --- path 4: error surface when the source PR is malformed -----------
    print("\n[4] PublishError on a malformed source_pr")
    try:
        GitHubPublisher(source_pr="not-a-pr")
        failures.append("PublishError was not raised on malformed source_pr")
    except PublishError as exc:
        print(f"  PublishError raised: {exc}")
    except Exception as exc:  # noqa: BLE001
        failures.append(f"unexpected exception type: {type(exc).__name__}: {exc}")

    print("\n" + "=" * 72)
    if failures:
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: QA GitHub Publisher integration test passed")
    print("    - NoOp path is well-formed (mode=noop, no MCP calls)")
    print("    - Live flow round-trips the 4 publisher tools in order")
    print("    - publish_meta is surfaced on both AgentResult and TestRun")
    print("    - Malformed source_pr raises PublishError")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
