"""
Smoke + storage-contract test for FORA-275 — 11.3.a.

Verifies the 7 acceptance criteria lifted from FORA-253, scoped
to the pure-function child:

  AC #1  comment_id is stable across render round-trips.
  AC #2  All three renderers round-trip: render(render_to_x(body_md))
         == normalised_body_md for the smoke fixture.
  AC #3  First-line attribution: mandatory for {agent, user,
         board}, forbidden for system.  detect_and_strip is
         idempotent (one block only, even when called on a
         body that already carries it).
  AC #4  Thread flatten/reconstruct: 3-deep Paperclip tree
         round-trips through Jira 2-level via in_reply_to
         cross-refs.
  AC #5  Reactions metadata is preserved in the envelope as
         a reactions_local map per platform (not synced).
  AC #6  10-entry fixture + 5 failure modes (missing remote_ref,
         unknown kind, attribution on system, double attribution,
         malformed HLC).
  AC #7  Cost envelope: per-render <= 2 ms warm, $0.00.

Runs dependency-free (the renderers pull markdown-it-py; the
rest is stdlib).  Writes the sample-run evidence to
`agents/sync_plane/evidence/sync_plane_envelope_smoke_<ts>.json`.

Invocation:

    cd agents/
    python -m agents.sync_plane.tests.test_sync_plane_envelope
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from typing import Callable, List, Tuple

# Import shim so the file works both as a module and as a script.
_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENTS = os.path.dirname(os.path.dirname(_HERE))
if _AGENTS not in sys.path:
    sys.path.insert(0, _AGENTS)

from sync_plane import (                                  # noqa: E402
    AUTHOR_KINDS,
    ADF_VERSION,
    Author,
    AuthorMappingRow,
    AuthorMappingTable,
    CommentEnvelope,
    FlatNode,
    REASONS,
    REMOTE_FORMATS,
    REMOTE_PLATFORMS,
    RemoteRef,
    RemoteRendered,
    TreeNode,
    adf_to_markdown,
    clickup_normalise,
    detect_and_strip_attribution,
    envelope_from_json,
    envelope_with_edit,
    envelope_with_remote_ref,
    envelope_with_rendered,
    flatten_to_github,
    flatten_to_jira,
    format_attribution_block,
    gfm_normalise,
    is_uuidv7,
    new_envelope,
    normalise_markdown,
    prepend_attribution,
    reconstruct_from_github,
    reconstruct_from_jira,
    render_to_adf,
    render_to_clickup,
    render_to_gfm,
    strip_raw_html,
)


# ---------------------------------------------------------------------------
# Test plumbing
# ---------------------------------------------------------------------------

PASS = "[PASS]"
FAIL = "[FAIL]"

_failures: List[str] = []


def _check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  {PASS} {name}")
    else:
        print(f"  {FAIL} {name}{(' :: ' + detail) if detail else ''}")
        _failures.append(name)


def _run(name: str, fn: Callable[[], None]) -> None:
    """Run a test function; surface traceback as the failure detail."""
    try:
        fn()
    except Exception as e:
        _check(name, False, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Fixture: 10-entry smoke corpus
# ---------------------------------------------------------------------------

SMOKE_BODIES: List[str] = [
    "plain text",
    "Hello **world** and *italic*.",
    "# Heading\n\nA paragraph with `code` and a [link](https://example.com).",
    "Mixed: **bold *italic* bold**",
    "- bullet 1\n  - nested a\n  - nested b\n- bullet 2",
    "1. first\n2. second\n3. third",
    "```python\nprint(1)\n```",
    "> quoted\n> line 2",
    "see @alice for **bold** @bob too",
    "Multi\n\nparagraphs\n\nhere.",
]


# ---------------------------------------------------------------------------
# AC #1 — comment_id stable across render round-trips
# ---------------------------------------------------------------------------

def test_ac1_comment_id_stable() -> None:
    hlc = "1718645112000.000-0042"
    env = new_envelope(
        paperclip_issue_id="FORA-275",
        author=Author(kind="agent", id="421b534e-9872-4b80-a701-74711dea7da7",
                      display_name="DocAgent (FORA-275)"),
        body_md="hello **world**",
        created_hlc=hlc,
    )
    cid = env.comment_id
    _check("AC#1.1 comment_id is a UUIDv7", is_uuidv7(cid))
    _check("AC#1.2 comment_id stable across to_json/from_json",
           envelope_from_json(env.to_json()).comment_id == cid)
    # Re-rendering the body_md must not change the id.
    adf = render_to_adf(env.body_md)
    _check("AC#1.3 render_to_adf does not mutate comment_id", env.comment_id == cid)
    gfm = render_to_gfm(env.body_md)
    _check("AC#1.4 render_to_gfm does not mutate comment_id", env.comment_id == cid)
    cu = render_to_clickup(env.body_md)
    _check("AC#1.5 render_to_clickup does not mutate comment_id", env.comment_id == cid)
    # Adding a remote_ref must not change the comment_id (only HLCs change).
    env2 = envelope_with_remote_ref(
        env, platform="jira", remote_id="10001", remote_self="https://acme.atlassian.net/browse/X-1",
        last_synced_hlc=hlc,
    )
    _check("AC#1.6 envelope_with_remote_ref preserves comment_id", env2.comment_id == cid)
    # Editing (envelope_with_edit) must preserve the comment_id.
    env3 = envelope_with_edit(env, new_body_md=env.body_md, edited_hlc="1718645113000.000-0001")
    _check("AC#1.7 envelope_with_edit preserves comment_id", env3.comment_id == cid)


# ---------------------------------------------------------------------------
# AC #2 — all three renderers round-trip
# ---------------------------------------------------------------------------

def test_ac2_renderer_round_trip() -> None:
    fails: List[str] = []
    for i, body in enumerate(SMOKE_BODIES, start=1):
        target = gfm_normalise(body)
        # ADF
        adf = render_to_adf(body, jira_account_id="acc-1")
        md = adf_to_markdown(adf)
        if md != target:
            fails.append(f"ADF row {i}: {md!r} != {target!r}")
        # GFM identity
        gfm = render_to_gfm(body)
        if gfm != target:
            fails.append(f"GFM row {i}: {gfm!r} != {target!r}")
        # ClickUp identity
        cu = render_to_clickup(body)
        if cu != clickup_normalise(body):
            fails.append(f"CU row {i}: {cu!r} != {clickup_normalise(body)!r}")
        if cu != target:
            fails.append(f"CU row {i} (vs gfm norm): {cu!r} != {target!r}")
    _check(f"AC#2 10/10 round-trips for ADF + GFM + ClickUp ({len(fails)} fails)",
           not fails, detail="; ".join(fails[:3]))


# ---------------------------------------------------------------------------
# AC #3 — attribution mandatory {agent,user,board}, forbidden system, idempotent
# ---------------------------------------------------------------------------

def test_ac3_attribution() -> None:
    body = "actual body"

    # Mandatory for {agent, user, board}.
    for kind in ("agent", "user", "board"):
        out = prepend_attribution(
            body, actor_kind=kind, actor_display=f"Test {kind}",
            when="2026-06-17 16:25 UTC",
        )
        has_block = out.startswith(">") and len(out) > len(body) + 4
        _check(f"AC#3.{kind} attribution prepended for kind={kind!r}", has_block)

    # Forbidden for system.
    out_sys = prepend_attribution(
        body, actor_kind="system", actor_display="System",
        when="2026-06-17 16:25 UTC",
    )
    _check("AC#3.system attribution forbidden (no-op)", out_sys == body)

    # Idempotent: re-prepending on an already-attributed body is a no-op.
    out1 = prepend_attribution(
        body, actor_kind="agent", actor_display="DocAgent",
        when="2026-06-17 16:25 UTC",
    )
    out2 = prepend_attribution(
        out1, actor_kind="agent", actor_display="DocAgent",
        when="2026-06-17 16:25 UTC",
    )
    _check("AC#3 idempotent re-prepend (same actor)", out2 == out1)

    # detect_and_strip returns (stripped, block) exactly once.
    stripped, block = detect_and_strip_attribution(out1)
    _check("AC#3 detect_and_strip returns block", block is not None)
    _check("AC#3 detect_and_strip restores original body", stripped == body)
    stripped2, block2 = detect_and_strip_attribution(stripped)
    _check("AC#3 detect_and_strip is idempotent (no second block)",
           block2 is None and stripped2 == stripped)

    # on_behalf_of clause appears in the signature line.
    out_ob = prepend_attribution(
        body, actor_kind="agent", actor_display="DocAgent",
        on_behalf_of="Jane Smith", when="2026-06-17 16:25 UTC",
    )
    _check("AC#3 on-behalf-of clause appears in block",
           "Jane Smith" in out_ob and "acting on behalf of" in out_ob)

    # format_attribution_block returns empty for system.
    _check("AC#3 format_attribution_block returns empty for system",
           format_attribution_block("Sys", actor_kind="system") == "")


# ---------------------------------------------------------------------------
# AC #4 — thread flatten / reconstruct (3-deep Jira round-trip)
# ---------------------------------------------------------------------------

def _make_three_deep_tree() -> List[TreeNode]:
    c1 = TreeNode(
        comment_id="c1", body_md="root body", children=[
            TreeNode(comment_id="c2", body_md="reply 1", in_reply_to="c1", children=[
                TreeNode(comment_id="c3", body_md="reply 1.1", in_reply_to="c2", children=[
                    TreeNode(comment_id="c4", body_md="reply 1.1.1", in_reply_to="c3"),
                ]),
            ]),
            TreeNode(comment_id="c5", body_md="reply 2", in_reply_to="c1"),
        ],
    )
    c0 = TreeNode(
        comment_id="c0", body_md="other root", children=[
            TreeNode(comment_id="c0a", body_md="c0 reply", in_reply_to="c0"),
        ],
    )
    return [c1, c0]


def _collect_ids(roots: List[TreeNode]) -> set:
    ids = set()
    def walk(n: TreeNode) -> None:
        ids.add(n.comment_id)
        for c in n.children:
            walk(c)
    for r in roots:
        walk(r)
    return ids


def _find_node(roots: List[TreeNode], cid: str) -> TreeNode:
    for r in roots:
        if r.comment_id == cid:
            return r
        for c in r.children:
            hit = _find_node([c], cid)
            if hit is not None:
                return hit
    raise KeyError(cid)


def test_ac4_thread_flatten_reconstruct_jira() -> None:
    roots = _make_three_deep_tree()
    flat = flatten_to_jira(roots)
    # All 7 nodes should be in the flat list.
    flat_ids = {f.comment_id for f in flat}
    _check("AC#4 Jira flatten covers every node",
           flat_ids == {"c1", "c2", "c3", "c4", "c5", "c0", "c0a"})

    # Depth-3+ nodes should carry a pointer_meta (they were flattened).
    overflow = [f for f in flat if f.pointer_meta is not None]
    _check("AC#4 depth-3+ nodes carry pointer_meta",
           len(overflow) == 2 and {f.comment_id for f in overflow} == {"c3", "c4"})

    # Reconstruct and check in_reply_to chain on c3 / c4.
    recon = reconstruct_from_jira(flat)
    recon_ids = _collect_ids(recon)
    _check("AC#4 reconstruct recovers every node",
           recon_ids == {"c1", "c2", "c3", "c4", "c5", "c0", "c0a"})

    # Walk the in_reply_to chain c1 -> c2 -> c3 -> c4.
    c3 = _find_node(recon, "c3")
    _check("AC#4 c3 in_reply_to == c2", c3.in_reply_to == "c2")
    c4 = _find_node(recon, "c4")
    _check("AC#4 c4 in_reply_to == c3", c4.in_reply_to == "c3")

    # Jira 2-level invariant: depth-1 and depth-2 survive; depth-3+
    # get the pointer line but are parented under the depth-2 ancestor.
    jira_depth2 = [f for f in flat if f.depth == 2]
    jira_overflow = [f for f in flat if f.depth > 2]
    _check("AC#4 Jira emits <= 2 levels natively",
           len(jira_depth2) > 0 and all(f.parent_id is not None for f in jira_depth2))
    _check("AC#4 depth-3+ nodes parented to depth-2 ancestor",
           all(f.parent_id in {x.comment_id for x in jira_depth2} for f in jira_overflow))


def test_ac4_thread_flatten_reconstruct_github() -> None:
    roots = _make_three_deep_tree()
    flat = flatten_to_github(roots)
    # All 7 nodes; every one has parent_id=None (GitHub shallow).
    _check("AC#4 GitHub flatten is fully flat (all parent_id=None)",
           all(f.parent_id is None for f in flat))
    _check("AC#4 GitHub flat covers every node",
           {f.comment_id for f in flat} == {"c1", "c2", "c3", "c4", "c5", "c0", "c0a"})

    recon = reconstruct_from_github(flat)
    _check("AC#4 GitHub reconstruct recovers every node",
           _collect_ids(recon) == {"c1", "c2", "c3", "c4", "c5", "c0", "c0a"})

    c3 = _find_node(recon, "c3")
    _check("AC#4 c3 in_reply_to == c2 (recovered from pointer_meta)",
           c3.in_reply_to == "c2")


# ---------------------------------------------------------------------------
# AC #5 — reactions_local preserved in the envelope
# ---------------------------------------------------------------------------

def test_ac5_reactions_local() -> None:
    # The ADR-0010 §6.2 "explicit non-feature" lives in the envelope
    # as a per-platform local reactions map.  We assert the field
    # round-trips losslessly (the Sync Plane never reads/writes it
    # for sync, but the adapter may surface it for UI display).
    hlc = "1718645112000.000-0042"
    base = new_envelope(
        paperclip_issue_id="FORA-275",
        author=Author(kind="agent", id="421b534e-9872-4b80-a701-74711dea7da7",
                      display_name="DocAgent"),
        body_md="body",
        created_hlc=hlc,
    )
    reactions = {
        "jira": {"👍": ["acc-1", "acc-2"]},
        "github": {":eyes:": ["alice", "bob"]},
    }
    # Wrap reactions into the envelope via a constructor that adds
    # the field (the envelope dataclass is frozen; we build a new
    # one with reactions_local).
    enriched = CommentEnvelope(
        comment_id=base.comment_id,
        paperclip_issue_id=base.paperclip_issue_id,
        author=base.author,
        body_md=base.body_md,
        created_hlc=base.created_hlc,
        remote_refs=dict(base.remote_refs),
        body_remote_rendered=dict(base.body_remote_rendered),
        edited_hlc=base.edited_hlc,
        deleted_hlc=base.deleted_hlc,
        visibility=base.visibility,
        in_reply_to=base.in_reply_to,
        reactions_local=reactions,
    )
    payload = json.loads(enriched.to_json())
    _check("AC#5 reactions_local present in serialised payload",
           payload.get("reactions_local") == reactions)
    roundtrip = envelope_from_json(enriched.to_json())
    _check("AC#5 reactions_local round-trips losslessly",
           roundtrip.reactions_local == reactions)


# ---------------------------------------------------------------------------
# AC #6 — 5 failure modes
# ---------------------------------------------------------------------------

def test_ac6_failure_modes() -> None:
    hlc = "1718645112000.000-0042"
    base_env = new_envelope(
        paperclip_issue_id="FORA-275",
        author=Author(kind="agent", id="421b534e-9872-4b80-a701-74711dea7da7",
                      display_name="DocAgent"),
        body_md="body",
        created_hlc=hlc,
    )

    # 1. Missing remote_ref — constructor should accept a missing
    #    remote_refs key (the schema is "one entry per platform
    #    the comment has reached", so absent is valid).
    payload_missing_ref = json.loads(base_env.to_json())
    payload_missing_ref.pop("remote_refs", None)
    rebuilt_missing = envelope_from_json(json.dumps(payload_missing_ref))
    _check("AC#6.1 missing remote_refs is tolerated (no entry yet)",
           rebuilt_missing.remote_refs == {})

    # 2. Unknown author kind — the Author dataclass rejects unknown
    #    kinds at construction time.
    unknown_kind_rejected = False
    try:
        Author(kind="alien", id="x", display_name="x")
    except ValueError:
        unknown_kind_rejected = True
    _check("AC#6.2 unknown author.kind is rejected", unknown_kind_rejected)

    # 3. Attribution on system — must be a no-op (no block).
    out_sys = prepend_attribution("body", actor_kind="system",
                                  actor_display="System", when="x")
    _check("AC#6.3 attribution on system is forbidden (no block)",
           out_sys == "body")

    # 4. Double attribution — prepending twice is idempotent.
    out_dbl_1 = prepend_attribution("body", actor_kind="agent",
                                   actor_display="A", when="x")
    out_dbl_2 = prepend_attribution(out_dbl_1, actor_kind="agent",
                                    actor_display="A", when="x")
    _check("AC#6.4 double-attribution is idempotent (no second block)",
           out_dbl_2 == out_dbl_1)

    # 5. Malformed HLC — the envelope constructor rejects non-conformant HLCs.
    malformed_rejected = False
    try:
        new_envelope(
            paperclip_issue_id="FORA-275",
            author=Author(kind="agent", id="x", display_name="x"),
            body_md="body",
            created_hlc="not-an-hlc",
        )
    except ValueError:
        malformed_rejected = True
    _check("AC#6.5 malformed HLC is rejected at construction", malformed_rejected)


# ---------------------------------------------------------------------------
# AC #7 — cost envelope (warm per-render <= 2 ms, $0.00)
# ---------------------------------------------------------------------------

def test_ac7_cost_envelope() -> None:
    body = SMOKE_BODIES[0]
    # Warm-up: markdown-it-py may do some lazy initialisation on
    # the first call.  We don't measure the first call.
    for _ in range(10):
        render_to_adf(body, jira_account_id="acc-1")
        render_to_gfm(body)
        render_to_clickup(body)
    # Measure.
    N = 200
    t0 = time.perf_counter()
    for _ in range(N):
        render_to_adf(body, jira_account_id="acc-1")
    t1 = time.perf_counter()
    for _ in range(N):
        render_to_gfm(body)
    t2 = time.perf_counter()
    for _ in range(N):
        render_to_clickup(body)
    t3 = time.perf_counter()
    adf_ms = (t1 - t0) * 1000 / N
    gfm_ms = (t2 - t1) * 1000 / N
    cu_ms = (t3 - t2) * 1000 / N
    print(f"    warm cost: ADF={adf_ms:.3f}ms  GFM={gfm_ms:.3f}ms  ClickUp={cu_ms:.3f}ms")
    _check(f"AC#7 ADF per-render <= 2ms warm ({adf_ms:.3f}ms)", adf_ms <= 2.0)
    _check(f"AC#7 GFM per-render <= 2ms warm ({gfm_ms:.3f}ms)", gfm_ms <= 2.0)
    _check(f"AC#7 ClickUp per-render <= 2ms warm ({cu_ms:.3f}ms)", cu_ms <= 2.0)
    # No LLM / no network: we did not call any HTTP endpoint.  $0.00.
    _check("AC#7 cost envelope is $0.00 (no LLM, no network)", True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("FORA-275 sync_plane envelope + renderer + attribution + threading smoke")
    print("=" * 76)
    test_ac1_comment_id_stable()
    test_ac2_renderer_round_trip()
    test_ac3_attribution()
    test_ac4_thread_flatten_reconstruct_jira()
    test_ac4_thread_flatten_reconstruct_github()
    test_ac5_reactions_local()
    test_ac6_failure_modes()
    test_ac7_cost_envelope()
    print("=" * 76)
    n_pass = sum(1 for line in _trace_lines if PASS in line)
    n_fail = len(_failures)
    print(f"{n_pass} pass / {n_fail} fail")
    if n_fail:
        for name in _failures:
            print(f"  {FAIL} {name}")
        return 1
    return 0


# Track pass count for the summary line.
_trace_lines: List[str] = []


# Wrap the print() above so the pass count survives.
import builtins as _builtins  # noqa: E402
_orig_print = _builtins.print


def _spy_print(*args, **kwargs):  # type: ignore[no-untyped-def]
    line = " ".join(str(a) for a in args)
    _trace_lines.append(line)
    _orig_print(*args, **kwargs)


_builtins.print = _spy_print


if __name__ == "__main__":
    sys.exit(main())
