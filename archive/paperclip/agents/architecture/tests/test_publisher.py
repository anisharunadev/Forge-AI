#!/usr/bin/env python3
"""
Unit tests for the architecture docs publisher (FORA-39, sub-goal 2.4).

Pure-function coverage only. I/O (Confluence, Slack) is exercised by the
smoke test in `smoke_test_publisher.py` against in-memory mocks.

Run:
    python3 -m pytest agents/architecture/tests/test_publisher.py -v
or:
    python3 agents/architecture/tests/test_publisher.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.architecture.publisher import (  # noqa: E402
    AdrRow,
    Artefact,
    Frontmatter,
    build_publish_plan,
    parse_artefacts,
    parse_frontmatter,
    publish_to_confluence,
    render_adr_index,
    render_index,
    to_storage_format,
    _rewrite_links,
)


class FakeConfluence:
    """Minimal in-memory Confluence client for unit tests."""

    def __init__(self) -> None:
        self.pages: Dict[str, Dict[str, Any]] = {}
        self._id_counter = 10000
        self.created = 0
        self.updated = 0
        self.fail_on_create: Optional[str] = None  # page title that should fail
        self.fail_on_update: Optional[str] = None

    def list_pages(
        self,
        *,
        limit: int = 100,
        cursor: Optional[str] = None,
        title: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for p in self.pages.values():
            if title and p["title"] != title:
                continue
            out.append(p)
        return out

    def get_page(self, page_id: str) -> Dict[str, Any]:
        return self.pages[page_id]

    def create_page(
        self,
        *,
        title: str,
        body: str,
        parent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self.fail_on_create and self.fail_on_create in title:
            raise RuntimeError("simulated create failure")
        self._id_counter += 1
        pid = str(self._id_counter)
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

    def update_page(
        self,
        *,
        page_id: str,
        title: str,
        body: str,
        version_number: int,
    ) -> Dict[str, Any]:
        if self.fail_on_update and self.fail_on_update in title:
            raise RuntimeError("simulated update failure")
        p = self.pages[page_id]
        p["title"] = title
        p["body"] = {"representation": "storage", "value": body}
        p["version"] = {
            "number": version_number + 1,
            "createdAt": "2026-06-17T00:00:01Z",
        }
        self.updated += 1
        return p


def _write_artefact(tmp: str, rel: str, body: str) -> None:
    path = os.path.join(tmp, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)


class TestParseFrontmatter(unittest.TestCase):
    def test_no_frontmatter(self) -> None:
        text = "# Hello\n\nbody text\n"
        fm, rest = parse_frontmatter(text)
        self.assertEqual(fm.raw, {})
        self.assertIsNone(fm.paperclip_issue)
        self.assertEqual(rest, text)

    def test_basic_frontmatter(self) -> None:
        text = (
            "---\n"
            "paperclip-issue: FORA-39\n"
            "status: accepted\n"
            "date: 2026-06-17\n"
            "---\n\n"
            "# body\n"
        )
        fm, rest = parse_frontmatter(text)
        self.assertEqual(fm.paperclip_issue, "FORA-39")
        self.assertEqual(fm.status, "accepted")
        self.assertEqual(fm.date, "2026-06-17")
        self.assertTrue(rest.startswith("# body"))

    def test_no_closing_fence(self) -> None:
        text = "---\nkey: value\nno close\nbody"
        fm, rest = parse_frontmatter(text)
        # No closing fence → original text returned unchanged
        self.assertEqual(fm.raw, {})
        self.assertEqual(rest, text)

    def test_long_file_with_internal_dashes(self) -> None:
        # openapi.yaml is 1695 lines; make sure parse is fast and correct
        body = "---\npaperclip-issue: FORA-35\n---\n\n" + ("x\n" * 5000) + "---\n"
        fm, rest = parse_frontmatter(body)
        self.assertEqual(fm.paperclip_issue, "FORA-35")
        # the body should be everything after the closing fence
        self.assertIn("x", rest)


class TestParseArtefacts(unittest.TestCase):
    def test_walks_supported_kinds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# HLD\n")
            _write_artefact(tmp, "lld.md", "# LLD\n")
            _write_artefact(tmp, "adr/0001-foo.md", "---\nstatus: accepted\n---\n# ADR\n")
            _write_artefact(tmp, "sequence/01-foo.mmd", "sequenceDiagram\nA->>B: hi\n")
            _write_artefact(tmp, "openapi.yaml", "openapi: 3.1.0\n")
            _write_artefact(tmp, "README.md", "ignored\n")  # not classified
            arts = parse_artefacts(tmp)
            kinds = sorted(a.kind for a in arts)
            self.assertEqual(
                kinds,
                sorted(["hld", "lld", "adr", "sequence", "openapi"]),
            )

    def test_adr_page_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "adr/0042-pick-the-best-thing.md", "# ADR\n")
            arts = parse_artefacts(tmp)
            self.assertEqual(len(arts), 1)
            self.assertEqual(arts[0].page_title, "ADR-0042 — pick the best thing")


class TestRenderAdrIndex(unittest.TestCase):
    def test_sorts_by_status_then_date(self) -> None:
        adrs = [
            AdrRow(number="0003", title="c", status="deprecated", date="2026-01-01",
                   page_title="x", rel_path="adr/0003.md"),
            AdrRow(number="0001", title="a", status="accepted", date="2026-05-01",
                   page_title="x", rel_path="adr/0001.md"),
            AdrRow(number="0002", title="b", status="proposed", date="2026-03-01",
                   page_title="x", rel_path="adr/0002.md"),
        ]
        md = render_adr_index(adrs)
        # accepted (0001) first, then proposed (0002), then deprecated (0003)
        idx_accepted = md.find("0001")
        idx_proposed = md.find("0002")
        idx_deprecated = md.find("0003")
        self.assertLess(idx_accepted, idx_proposed)
        self.assertLess(idx_proposed, idx_deprecated)
        self.assertIn("Total: 3 ADR(s)", md)


class TestToStorageFormat(unittest.TestCase):
    def test_heading(self) -> None:
        self.assertEqual(to_storage_format("# Hello\n"), "<h1>Hello</h1>")

    def test_bullet_list(self) -> None:
        out = to_storage_format("- a\n- b\n- c\n")
        self.assertIn("<ul>", out)
        self.assertIn("<li>a</li>", out)
        self.assertIn("</ul>", out)

    def test_emphasis(self) -> None:
        out = to_storage_format("**b** *i* `c`\n")
        self.assertIn("<strong>b</strong>", out)
        self.assertIn("<em>i</em>", out)
        self.assertIn("<code>c</code>", out)

    def test_link_without_index(self) -> None:
        out = to_storage_format("[label](hld.md)\n")
        # no index → link passes through unchanged (will be re-published)
        self.assertIn('<a href="hld.md">label</a>', out)

    def test_link_with_index_rewrites(self) -> None:
        out = to_storage_format("[label](hld.md)\n", link_index={"hld.md": "42"})
        self.assertIn('<a href="/wiki/spaces/ENG/pages/42">label</a>', out)
        self.assertNotIn('href="hld.md"', out)

    def test_code_fence(self) -> None:
        out = to_storage_format("```yaml\nfoo: 1\n```\n")
        self.assertIn('ac:name="code"', out)
        self.assertIn('ac:name="language">yaml</', out)
        # code body is escaped + wrapped in CDATA
        self.assertIn("<![CDATA[foo: 1]]>", out)


class TestPublishIdempotency(unittest.TestCase):
    def test_publish_then_publish_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# H\nbody\n")
            _write_artefact(tmp, "lld.md", "# L\nbody\n")
            _write_artefact(tmp, "adr/0001-a.md", "---\nstatus: accepted\n---\n# ADR\n")
            plan = build_publish_plan(tmp, epic_id="E1", source_issue="FORA-39")
            c = FakeConfluence()
            r1 = publish_to_confluence(c, plan)
            self.assertEqual(r1.pages_failed, 0)
            self.assertEqual(r1.pages_created, len(plan.pages))
            # second publish: zero creates, every page updated
            r2 = publish_to_confluence(c, plan)
            self.assertEqual(r2.pages_created, 0)
            self.assertEqual(r2.pages_failed, 0)
            self.assertEqual(r2.pages_updated, len(plan.pages))

    def test_per_artefact_failure_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# H\n")
            _write_artefact(tmp, "lld.md", "# L\n")
            plan = build_publish_plan(tmp, epic_id="E1", source_issue="FORA-39")
            c = FakeConfluence()
            c.fail_on_create = "lld"
            r = publish_to_confluence(c, plan)
            self.assertGreater(r.pages_failed, 0)
            # index + hld + adr-index still created
            self.assertGreater(r.pages_created, 0)

    def test_cross_references_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# H\nsee [lld](lld.md)\n")
            _write_artefact(tmp, "lld.md", "# L\nsee [hld](hld.md)\n")
            plan = build_publish_plan(tmp, epic_id="E1", source_issue="FORA-39")
            c = FakeConfluence()
            publish_to_confluence(c, plan)
            # bodies should now contain page-id links, not raw md links
            for p in c.pages.values():
                self.assertNotIn('href="lld.md"', p["body"]["value"])
                self.assertNotIn('href="hld.md"', p["body"]["value"])
            # but at least one page-id link exists
            any_rewritten = any(
                "/wiki/spaces/ENG/pages/" in p["body"]["value"]
                for p in c.pages.values()
            )
            self.assertTrue(any_rewritten, "expected at least one rewritten cross-ref")


class TestBuildPublishPlan(unittest.TestCase):
    def test_plan_covers_all_2_3_artefacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# H\n")
            _write_artefact(tmp, "lld.md", "# L\n")
            _write_artefact(tmp, "adr/0001-x.md", "---\nstatus: accepted\n---\n")
            _write_artefact(tmp, "sequence/01-x.mmd", "sequenceDiagram\n")
            plan = build_publish_plan(tmp, epic_id="E1", source_issue="FORA-39")
            # 4 source artefacts + index + adr-index = 6
            self.assertEqual(len(plan.pages), 6)
            titles = [p.page_title for p in plan.pages]
            self.assertIn("index", titles)
            self.assertIn("ADR index", titles)
            self.assertIn("hld", titles)
            self.assertIn("lld", titles)
            # frontmatter paperclip-issue propagates into the plan
            for p in plan.pages:
                self.assertEqual(p.paperclip_issue, "FORA-39")


class TestCostBound(unittest.TestCase):
    def test_publish_under_wall_clock_budget(self) -> None:
        # Wall-clock budget: < 120 s for a typical 6-artefact set (AC #6).
        # We assert < 5 s in unit tests (mock I/O; production has network).
        with tempfile.TemporaryDirectory() as tmp:
            _write_artefact(tmp, "hld.md", "# H\nbody\n")
            _write_artefact(tmp, "lld.md", "# L\nbody\n")
            _write_artefact(tmp, "openapi.yaml", "openapi: 3.1.0\n" + ("x: 1\n" * 200))
            plan = build_publish_plan(tmp, epic_id="E1", source_issue="FORA-39")
            c = FakeConfluence()
            r = publish_to_confluence(c, plan)
            self.assertLess(r.elapsed_ms_total, 5_000.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
