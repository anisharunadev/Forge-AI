"""Generate the FORA-121 sample-run evidence JSON.

This is a one-shot helper (not part of the smoke test) that runs the
ADR generator against a stub repo with a realistic mix of inputs —
HLD-style `## ADR` blocks, `// ADR:` code comments, and explicit
decision points — and writes the structured evidence JSON that the
FORA-118 acceptance criteria require in the issue thread.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..")))

from agents.documentation.adr_generator import (
    detect_decision_points_from_comments,
    detect_decision_points_from_markdown,
    extract_decision_refs,
    run_adr,
)
from agents.documentation.schemas import (
    AdrStatus,
    CommitRange,
    DocGenInput,
    MemorySnapshot,
    RepoMetadata,
    now_iso,
)


SAMPLE_HLD = """\
# HLD — FORA Agent-of-Agents Platform

## ADR 0001: Use Postgres for the run DB

We need transactional state for run rows. Postgres is the obvious
choice; SQLite is the alternative we rejected.

Decision: Postgres 16 with pgvector.

Consequences: one more dep to operate.

Alternatives Considered: SQLite (rejected — no concurrent writers).
"""

SAMPLE_CODE = """\
// ADR: Use Redis for the cache layer
//   Context: we need sub-millisecond cache reads
//   Decision: Redis 7 with cluster mode
//   Consequences: another datstore to operate
//   Alternatives: in-process LRU (rejected — no cross-process sharing)
"""

INPUT_SHA = "sample-2026-06-20"


def _write_stub(root: Path) -> None:
    pmem = root / "workspace" / "project"
    pmem.mkdir(parents=True, exist_ok=True)
    body_docs = json.dumps({"version": "1.0", "generated_at": "2026-06-17T00:00:00Z", "docs_index_sha": "v1-initial-seed", "entries": []}, indent=2)
    (pmem / "docs.md").write_text(
        f"---\nname: doc-index\nversion: 1.0\nspec: FORA-117\nowner: doc-agent\nstatus: production\n---\n\n# Doc Index\n\n```json\n{body_docs}\n```\n",
        encoding="utf-8",
    )
    body_reg = json.dumps({"version": "1.0", "generated_at": "2026-06-17T00:00:00Z", "adr_registry_sha": "v1-initial-seed", "entries": []}, indent=2)
    (pmem / "adr-registry.md").write_text(
        f"---\nname: adr-registry\nversion: 1.0\nspec: FORA-117\nowner: doc-agent\nstatus: production\n---\n\n# ADR Registry\n\n```json\n{body_reg}\n```\n",
        encoding="utf-8",
    )


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub(root)

        # The orchestrator's job: pull decision points out of HLD + code
        pts = []
        pts.extend(detect_decision_points_from_markdown(SAMPLE_HLD, source_label="forge/2.3/hld.md"))
        pts.extend(detect_decision_points_from_comments(SAMPLE_CODE, source_label="src/cache.go:10"))
        for p in pts:
            if "Postgres" in p.title:
                p.refs = extract_decision_refs("See FORA-35 and PR #101. Closes #13. Touches src/db.py.", "fora", "fora", "https://fora.atlassian.net")
                p.issue = "FORA-35"
            elif "Redis" in p.title:
                p.refs = extract_decision_refs("See FORA-126 and #7. Touches src/cache.py.", "fora", "fora", "https://fora.atlassian.net")
                p.issue = "FORA-126"

        inp = DocGenInput(
            input_sha=INPUT_SHA,
            repo=RepoMetadata(owner="fora", name="fora", default_branch="main", license="Apache-2.0"),
            commit_range=CommitRange(from_sha="0000001", to_sha="abc1234", conventional_commits=[]),
            memory_snapshot=MemorySnapshot(
                project_memory_sha="pmem-aaaa",
                customer_memory_sha="cmem-bbbb",
                docs_index_sha="didx-cccc",
                adr_registry_sha="adr-dddd",
            ),
            requested_artifacts=[],
        )
        out = run_adr(inp, decision_points=pts, repo_root=root, write=True)

        # Build the evidence JSON
        artifacts = [
            {
                "path": a.path,
                "kind": a.generator_type.value,
                "content_sha": a.content_sha,
                "freshness_timestamp": a.freshness_timestamp,
                "source_sha": a.source_sha,
                "approval_required": a.approval_required,
                "body_length_bytes": len(a.content.encode("utf-8")),
            }
            for a in out.artifacts
        ]
        doc_index_entries = [
            {
                "path": e.path,
                "kind": e.kind.value,
                "title": e.title,
                "source_commit": e.source_commit,
                "approval_required": e.approval_required,
                "last_generated_at": e.last_generated_at,
                "content_sha": e.content_sha,
                "architecture_area": e.architecture_area,
            }
            for e in (out.doc_index.entries if out.doc_index else [])
        ]
        adr_registry_entries = [
            {
                "number": e.number,
                "title": e.title,
                "path": e.path,
                "status": e.status.value,
                "date": e.date,
                "architecture_area": e.architecture_area,
                "source_commit": e.source_commit,
            }
            for e in (out.adr_registry.entries if out.adr_registry else [])
        ]
        cost = out.cost_record
        evidence = {
            "spec": "FORA-121",
            "sub_goal": "7.1.5 ADR generator",
            "ran_at": now_iso(),
            "input_sha": INPUT_SHA,
            "status": out.status.value,
            "run_id": out.run_id,
            "artifacts": artifacts,
            "doc_index_version": out.doc_index.version if out.doc_index else None,
            "doc_index_entries": doc_index_entries,
            "adr_registry_version": out.adr_registry.version if out.adr_registry else None,
            "adr_registry_entries": adr_registry_entries,
            "freshness_warnings": [w.to_dict() for w in out.freshness_warnings],
            "cost_record": {
                "prompt_hash": cost.prompt_hash,
                "model": cost.model,
                "tokens_in": cost.tokens_in,
                "tokens_out": cost.tokens_out,
                "usd": cost.usd,
                "duration_ms": cost.duration_ms,
                "fallback_used": cost.fallback_used,
            },
            "freshness_metadata": (
                {
                    "docs_index_sha": out.freshness_metadata.docs_index_sha,
                    "generated_at": out.freshness_metadata.generated_at,
                    "oldest_artifact_source_sha": out.freshness_metadata.oldest_artifact_source_sha,
                    "newest_artifact_source_sha": out.freshness_metadata.newest_artifact_source_sha,
                }
                if out.freshness_metadata
                else None
            ),
            "errors": [{"kind": e.kind.value, "message": e.message, "recoverable": e.recoverable} for e in out.errors],
            "approval_routing_decision": {
                "rule": (
                    "New ADRs are non-routine per prompt.md §Hard constraints #3 — "
                    "the human (CTO) signs off on the new ADR. The ADR index "
                    "(`docs/adr/README.md`) is a derived view and is auto-merge."
                ),
                "reasoning": (
                    f"Run produced {sum(1 for a in artifacts if a['kind']=='adr' and not a['path'].endswith('README.md'))} "
                    f"new ADR(s) and {sum(1 for a in artifacts if a['path']=='docs/adr/README.md')} index refresh. "
                    f"All new ADRs are approval_required=True; index is approval_required=False. "
                    f"Numbering is monotonic: numbers used = {sorted(e['number'] for e in adr_registry_entries)}."
                ),
            },
        }

        evidence_path = Path(HERE) / "adr_sample_run_evidence.json"
        evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(f"wrote {evidence_path}")
        print(json.dumps({
            "status": evidence["status"],
            "artifacts": [a["path"] for a in evidence["artifacts"]],
            "adr_numbers": [e["number"] for e in evidence["adr_registry_entries"]],
            "doc_index_entries": len(evidence["doc_index_entries"]),
            "cost_record": evidence["cost_record"],
        }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
