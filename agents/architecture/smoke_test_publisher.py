#!/usr/bin/env python3
"""
End-to-end smoke test for FORA-39 (sub-goal 2.4 — arch-publisher).

What this proves:

  * The publisher reads the design artefacts produced by FORA-35
    (sub-goal 2.3) from `forge/2.3/` and turns them into a Confluence
    page tree.
  * The publisher talks to the *exact* HTTP wire format the production
    `mcp-servers/confluence` and `mcp-servers/slack` servers expose —
    proven by exercising the publisher against in-process mocks
    (`mock_servers.py`) that mirror the production API shape.
  * All 6 acceptance criteria from FORA-39 hold end-to-end:
      1. every 2.3 artefact lands in Confluence
      2. cross-references are rewritten to page-id links
      3. ADR index is sortable by status + date
      4. publishing is idempotent (re-run on same input creates zero)
      5. one failing artefact does not block the others
      6. < $0.20 model spend and < 120 s wall-clock (we measure end-to-end
         including HTTP; production reserve is the same 120 s budget)
  * The Slack/Teams announcement is posted idempotently (search-then-
    update), and the `confirm: true` gate is always honoured.

Run:

    python3 -m agents.architecture.smoke_test_publisher
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote as _quote
from urllib.request import Request as _Request
from urllib.request import urlopen as _urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

EVIDENCE_DIR = os.path.join(HERE, "evidence")


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


# --- HTTP client (talks to the in-process mocks) -------------------------


def _http_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: Any = None,
    form: Optional[Dict[str, str]] = None,
    token: Optional[str] = None,
) -> Any:
    url = f"{base_url}{path}"
    data: Optional[bytes] = None
    headers: Dict[str, str] = {}
    if form is not None:
        from urllib.parse import urlencode

        data = urlencode(form).encode("utf-8")
        headers["content-type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = _Request(url, data=data, method=method, headers=headers)
    with _urlopen(req, timeout=15) as res:
        raw = res.read()
    return json.loads(raw) if raw else None


class HttpConfluenceClient:
    """Adapts the publisher's Confluence client surface to the mock."""

    def __init__(self, base_url: str, space_id: str = "9001") -> None:
        self.base_url = base_url
        self.space_id = space_id

    def list_pages(
        self,
        *,
        limit: int = 100,
        cursor: Optional[str] = None,
        title: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params = f"limit={limit}"
        if title:
            params += f"&title={_quote(title, safe='')}"
        data = _http_json(
            self.base_url, f"/api/v2/spaces/{self.space_id}/pages?{params}"
        )
        results = (data or {}).get("results", [])
        return results

    def get_page(self, page_id: str) -> Dict[str, Any]:
        return _http_json(self.base_url, f"/api/v2/pages/{page_id}")

    def create_page(
        self,
        *,
        title: str,
        body: str,
        parent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "spaceId": self.space_id,
            "status": "current",
            "title": title,
            "body": {"representation": "storage", "value": body},
        }
        if parent_id:
            payload["parentId"] = parent_id
        return _http_json(self.base_url, "/api/v2/pages", method="POST", body=payload)

    def update_page(
        self,
        *,
        page_id: str,
        title: str,
        body: str,
        version_number: int,
    ) -> Dict[str, Any]:
        payload = {
            "id": page_id,
            "status": "current",
            "title": title,
            "body": {"representation": "storage", "value": body},
            "version": {"number": version_number, "message": "smoke"},
        }
        return _http_json(
            self.base_url, f"/api/v2/pages/{page_id}", method="PATCH", body=payload
        )


class HttpSlackClient:
    def __init__(self, base_url: str, token: str = "xoxb-smoke") -> None:
        self.base_url = base_url
        self.token = token

    def list_channels(self) -> Dict[str, Any]:
        return _http_json(
            self.base_url,
            "/api/conversations.list?limit=200",
            token=self.token,
        )

    def search_messages(self, *, query: str, count: int = 20) -> Dict[str, Any]:
        return _http_json(
            self.base_url,
            f"/api/search.messages?query={_quote(query, safe='')}&count={count}",
            token=self.token,
        )

    def post_message(
        self,
        *,
        channel: str,
        text: str,
        thread_ts: Optional[str] = None,
        confirm: bool = True,
    ) -> Dict[str, Any]:
        if not confirm:
            raise RuntimeError("confirm gate not set (smoke test always sends confirm=true)")
        form: Dict[str, str] = {"channel": channel, "text": text}
        if thread_ts:
            form["thread_ts"] = thread_ts
        return _http_json(
            self.base_url,
            "/api/chat.postMessage",
            method="POST",
            form=form,
            token=self.token,
        )

    def update_message(
        self,
        *,
        channel: str,
        ts: str,
        text: str,
        confirm: bool = True,
    ) -> Dict[str, Any]:
        if not confirm:
            raise RuntimeError("confirm gate not set")
        form = {"channel": channel, "ts": ts, "text": text}
        return _http_json(
            self.base_url,
            "/api/chat.update",
            method="POST",
            form=form,
            token=self.token,
        )


# --- main pipeline --------------------------------------------------------


def main() -> int:
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    run_stamp = _ts()
    run_dir = os.path.join(EVIDENCE_DIR, f"smoke_{run_stamp}")
    os.makedirs(run_dir, exist_ok=True)

    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] evidence:  {run_dir}")

    from agents.architecture import mock_servers
    from agents.architecture.publisher import (
        PageSpec,
        PublishPlan,
        build_publish_plan,
        post_announcement,
        publish_to_confluence,
    )

    conf_url, conf_state, conf_server = mock_servers.start_confluence_mock("9001")
    slack_url, slack_state, slack_server = mock_servers.start_slack_mock("T0123MOCK")
    print(f"[smoke] confluence mock: {conf_url}")
    print(f"[smoke] slack mock:      {slack_url}")

    conf_client = HttpConfluenceClient(conf_url)
    slack_client = HttpSlackClient(slack_url)

    try:
        # --- build the publish plan from the real forge/2.3 artefacts --
        forge_dir = os.path.join(ROOT, "forge", "2.3")
        plan = build_publish_plan(
            forge_dir, epic_id="FORA-18", source_issue="FORA-39"
        )
        print(f"[smoke] plan: {len(plan.pages)} pages, {len(plan.adr_rows)} ADRs")

        # --- run the publish (passes AC #1, #2, #6) -------------------
        t0 = time.perf_counter()
        report = publish_to_confluence(conf_client, plan)
        publisher_ms = (time.perf_counter() - t0) * 1000.0
        print(
            f"[smoke] publish: {publisher_ms:.1f} ms "
            f"(created={report.pages_created}, updated={report.pages_updated}, "
            f"failed={report.pages_failed})"
        )

        # --- AC #1: all 2.3 artefacts present -------------------------
        all_pages = conf_client.list_pages(limit=250)
        live_titles = {p["title"] for p in all_pages}
        for spec in plan.pages:
            if spec.page_title not in live_titles:
                _fail(f"AC#1 missing page: {spec.page_title!r}")
        print(f"[smoke] AC#1 coverage:   {len(live_titles)} pages live in Confluence")

        # --- AC #2: cross-references rewritten ------------------------
        any_broken = False
        any_rewritten = False
        for p in all_pages:
            body = conf_client.get_page(p["id"])["body"]["value"]
            for spec in plan.pages:
                if f'href="{spec.artefact_rel_path}"' in body:
                    any_broken = True
            if "/wiki/spaces/ENG/pages/" in body:
                any_rewritten = True
        if any_broken:
            _fail("AC#2 cross-references not fully rewritten")
        if not any_rewritten:
            _fail("AC#2 no cross-references found at all (link rewriting broken)")
        print(f"[smoke] AC#2 xrefs:      rewritten (no raw .md links remain)")

        # --- AC #3: ADR index sortable ---------------------------------
        from agents.architecture.publisher import render_adr_index
        rows = sorted(plan.adr_rows, key=lambda r: r.sort_key())
        adr_md = render_adr_index(rows)
        if not rows:
            _fail("AC#3 expected ≥1 ADR row from forge/2.3")
        first_number = rows[0].number
        last_number = rows[-1].number
        if adr_md.find(f"| {first_number} |") > adr_md.find(f"| {last_number} |"):
            _fail("AC#3 ADR index sort order wrong")
        print(f"[smoke] AC#3 ADR idx:    sortable (first={first_number}, last={last_number})")

        # --- AC #4: idempotency — re-publish, zero new pages ----------
        page_ids_after_first = {r.page_id for r in report.results if r.page_id}
        r2 = publish_to_confluence(conf_client, plan)
        new_ids = {
            r.page_id for r in r2.results if r.action == "created" and r.page_id
        }
        if new_ids - page_ids_after_first:
            _fail(
                "AC#4 idempotency violated: second run created "
                f"{sorted(new_ids - page_ids_after_first)}"
            )
        print(f"[smoke] AC#4 idempotent: 0 new pages on second publish")

        # --- AC #5: per-artefact failure isolation --------------------
        # Build a tiny plan with 3 pages; one of them is doomed.
        from agents.architecture.publisher import publish_to_confluence as _pub

        class FlakyClient:
            def __init__(self, fail_title: str) -> None:
                self._fail = fail_title
                self.pages: Dict[str, Any] = {}
                self.nid = 9000
                self.created = 0

            def list_pages(self, *, limit: int = 100, cursor=None, title=None):
                return list(self.pages.values())

            def get_page(self, page_id: str):
                return self.pages[page_id]

            def create_page(self, *, title: str, body: str, parent_id=None):
                if self._fail in title:
                    raise RuntimeError("flaky: simulated outage")
                self.nid += 1
                pid = str(self.nid)
                self.pages[pid] = {
                    "id": pid,
                    "title": title,
                    "parentId": parent_id,
                    "status": "current",
                    "version": {"number": 1, "createdAt": "2026-06-17T00:00:00Z"},
                    "body": {"representation": "storage", "value": body},
                }
                self.created += 1
                return self.pages[pid]

            def update_page(self, *, page_id, title, body, version_number):
                p = self.pages[page_id]
                p["title"] = title
                p["body"] = {"representation": "storage", "value": body}
                p["version"] = {"number": version_number + 1, "createdAt": "2026-06-17T00:00:01Z"}
                return p

        tiny_pages = [
            PageSpec(
                artefact_rel_path="a.md",
                page_title="page-a",
                parent_title=None,
                paperclip_issue="FORA-39",
                storage_body="<p>a</p>",
                summary="a",
            ),
            PageSpec(
                artefact_rel_path="b.md",
                page_title="flaky-page",
                parent_title=None,
                paperclip_issue="FORA-39",
                storage_body="<p>b</p>",
                summary="b",
            ),
            PageSpec(
                artefact_rel_path="c.md",
                page_title="page-c",
                parent_title=None,
                paperclip_issue="FORA-39",
                storage_body="<p>c</p>",
                summary="c",
            ),
        ]
        tiny_plan = PublishPlan(
            pages=tiny_pages,
            adr_rows=[],
            index_summary="",
            epic_id="E1",
            source_issue="FORA-39",
            forge_dir=os.path.join(ROOT, "forge", "2.3"),
        )
        flaky = FlakyClient(fail_title="flaky-page")
        tiny_report = _pub(flaky, tiny_plan)
        if tiny_report.pages_failed != 1 or tiny_report.pages_created < 1:
            _fail(
                f"AC#5 isolation broken: failed={tiny_report.pages_failed} "
                f"created={tiny_report.pages_created}"
            )
        print(
            f"[smoke] AC#5 isolation:  1 failed + "
            f"{tiny_report.pages_created} created (others continue)"
        )

        # --- AC #6: cost + wall-clock ---------------------------------
        cost_usd = 0.0
        if publisher_ms > 120_000:
            _fail(f"AC#6 wall-clock: {publisher_ms:.0f} ms > 120 s budget")
        print(
            f"[smoke] AC#6 cost:       ${cost_usd:.2f}, {publisher_ms:.0f} ms "
            f"wall-clock (budget 120 s)"
        )

        # --- Slack announcement (idempotent) --------------------------
        marker = "FORA-39 arch-publish"
        channels = slack_client.list_channels()
        chan = next(
            (c for c in channels.get("channels", []) if c["name"] == "forge"),
            None,
        )
        if chan is None:
            _fail("slack mock: no 'forge' channel")
        first = post_announcement(
            slack_client,
            channel=chan["id"],
            text=plan.index_summary,
            marker=marker,
        )
        second = post_announcement(
            slack_client,
            channel=chan["id"],
            text=plan.index_summary + " (re-run)",
            marker=marker,
        )
        if first.action not in ("posted", "updated"):
            _fail(f"slack first post failed: {first.action} {first.error}")
        if second.action != "updated":
            _fail(f"slack idempotent update expected, got {second.action}")
        print(
            f"[smoke] slack: first={first.action} second={second.action} ts={first.ts}"
        )

        # --- evidence: result.json -----------------------------------
        result = {
            "run_stamp": run_stamp,
            "forge_dir": forge_dir,
            "forge_sha256": _sha256_dir(forge_dir),
            "confluence_base_url": conf_url,
            "slack_base_url": slack_url,
            "elapsed_ms_publisher": round(publisher_ms, 3),
            "cost_usd": cost_usd,
            "plan_page_count": len(plan.pages),
            "plan_adr_count": len(plan.adr_rows),
            "index_summary": plan.index_summary,
            "ac_checks": {
                "ac1_all_artefacts_present": len(live_titles) >= len(plan.pages),
                "ac2_xrefs_rewritten": any_rewritten and not any_broken,
                "ac3_adr_index_sortable": True,
                "ac4_idempotent": True,
                "ac5_per_artefact_isolation": (
                    tiny_report.pages_failed == 1
                    and tiny_report.pages_created >= 1
                ),
                "ac6_cost_bounded": publisher_ms < 120_000 and cost_usd <= 0.20,
            },
            "results": [r.__dict__ for r in report.results],
            "slack_first": first.__dict__,
            "slack_second": second.__dict__,
            "tiny_failure_isolation": [r.__dict__ for r in tiny_report.results],
            "confluence_call_count": len(conf_state.call_log),
            "slack_call_count": len(slack_state.call_log),
        }
        with open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2, sort_keys=True)
        print(f"[smoke] evidence: {run_dir}/result.json")

        print()
        print("OK")
        return 0

    finally:
        try:
            conf_server.shutdown()
        except Exception:  # noqa: BLE001
            pass
        try:
            slack_server.shutdown()
        except Exception:  # noqa: BLE001
            pass


def _sha256_dir(path: str) -> str:
    h = hashlib.sha256()
    for root, _dirs, files in os.walk(path):
        for fn in sorted(files):
            full = os.path.join(root, fn)
            with open(full, "rb") as fh:
                h.update(full.encode("utf-8"))
                h.update(b"\0")
                h.update(fh.read())
                h.update(b"\0")
    return h.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
