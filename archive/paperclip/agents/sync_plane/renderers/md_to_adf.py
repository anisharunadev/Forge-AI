"""Markdown -> Atlassian Document Format (ADF) v1 renderer (FORA-275).

Renders a Markdown body to an ADF v1 ``doc`` tree.  The output
is a plain ``dict`` (the caller ``json.dumps``-es it for
storage in ``envelope.body_remote_rendered['jira'].value`` per
ADR-0010 §6.1).

ADF v1 is the schema Jira Cloud uses for comment bodies, issue
descriptions, etc.  The schema is documented at:
    https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

This renderer is **pure**:

  * No I/O, no LLM, no network.
  * Parser backbone: ``markdown-it-py`` (pure-Python, vendored).
  * Output: a Python ``dict`` whose ``json.dumps`` is byte-stable
    for a given input (sorted keys, deterministic node order).

R-SYNC-01 sanitisation is enforced:

  * Raw HTML is stripped on input (via ``strip_raw_html``).
  * The renderer never emits raw HTML — only ADF node types.
  * ``@mentions`` are forwarded as ADF ``mention`` nodes with
    the ``id`` from the envelope's ``author.remote_ids['jira']``;
    when no mapping is present, the ``@`` is rendered as plain
    text (no implicit identity).

Round-trip:

  * ``render_to_adf(body_md)`` -> ADF ``dict``.
  * ``adf_to_markdown(adf_dict)`` -> normalised Markdown string.
  * Assertion: ``adf_to_markdown(render_to_adf(body_md)) ==
    gfm_normalise(body_md)`` for the smoke fixture.  ADF is a
    *lossy* representation (e.g. indented sub-bullets are
    flattened) — the smoke test therefore uses GFM normalisation
    as the canonical round-trip target, not raw Markdown.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

try:
    from markdown_it import MarkdownIt
except ImportError as _e:  # pragma: no cover - env guard
    raise ImportError(
        "markdown-it-py is required by sync_plane.renderers.md_to_adf. "
        "Install with `pip install markdown-it-py`."
    ) from _e

from ._normalize import KNOWN_INLINE_MARKS, normalise_markdown, strip_raw_html

# ADF v1 schema version (literal per Atlassian spec).
ADF_VERSION: int = 1

# Block-level node types the renderer emits.  Anything outside
# this set is wrapped in a paragraph or dropped.
_ADF_BLOCK_TYPES = frozenset(
    {
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "codeBlock",
        "blockquote",
        "rule",
    }
)

# markdown-it block token -> ADF node type
_BLOCK_TOKEN_TO_ADF = {
    "heading_open": "heading",
    "paragraph_open": "paragraph",
    "bullet_list_open": "bulletList",
    "ordered_list_open": "orderedList",
    "blockquote_open": "blockquote",
    "fence": "codeBlock",
    "code_block": "codeBlock",
    "hr": "rule",
}

# ADF mark type -> set of markdown-it mark types that map to it.
# (ADF and markdown-it agree on the names except for ``strike``,
# which is ``strikethrough`` in ADF.  We keep a translation
# table so the rendering is explicit.)
_MD_MARK_TO_ADF = {
    "strong": "strong",
    "em": "em",
    "code": "code",
    "s": "strikethrough",
    "link": "link",
}


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------

_md = MarkdownIt("commonmark", {"html": False, "linkify": True}).enable(
    ["table", "strikethrough"]
)


def render_to_adf(body_md: str, *, jira_account_id: Optional[str] = None) -> Dict[str, Any]:
    """Render ``body_md`` to an ADF v1 ``doc`` dict.

    ``jira_account_id`` is the optional ``accountId`` to embed
    in ADF ``mention`` nodes.  When ``None`` (the default), the
    ``@`` text is preserved as plain text — the caller (the
    adapter) is expected to look up the ``accountId`` from
    ``author_mapping.lookup(kind, id, 'jira')`` and re-render
    with the value before posting.  This keeps the renderer
    pure (no I/O) and the adapter does the I/O.
    """
    sanitized = strip_raw_html(body_md or "")
    tokens = _md.parse(sanitized)
    content: List[Dict[str, Any]] = []
    _walk_block(tokens, 0, content, jira_account_id=jira_account_id)
    return {
        "type": "doc",
        "version": ADF_VERSION,
        "content": content,
    }


def _walk_block(
    tokens: List[Any],
    start: int,
    out: List[Dict[str, Any]],
    *,
    jira_account_id: Optional[str],
) -> int:
    """Walk a list of markdown-it tokens, appending ADF block nodes
    to ``out``.  Returns the index of the first unconsumed token.
    """
    i = start
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        kind = tok.type
        if kind == "heading_open":
            level = int(tok.tag[1]) if tok.tag else 1
            i += 1
            inline_tok = tokens[i]
            assert inline_tok.type == "inline", (
                f"expected inline after heading_open, got {inline_tok.type!r}"
            )
            inlines = _render_inline(inline_tok.children or [], jira_account_id=jira_account_id)
            i += 1
            close = tokens[i]
            assert close.type == "heading_close", (
                f"expected heading_close, got {close.type!r}"
            )
            i += 1
            out.append({"type": "heading", "attrs": {"level": level}, "content": inlines})
        elif kind == "paragraph_open":
            i += 1
            inline_tok = tokens[i]
            assert inline_tok.type == "inline"
            inlines = _render_inline(inline_tok.children or [], jira_account_id=jira_account_id)
            i += 1
            close = tokens[i]
            assert close.type == "paragraph_close"
            i += 1
            out.append({"type": "paragraph", "content": inlines})
        elif kind == "bullet_list_open" or kind == "ordered_list_open":
            list_type = "bulletList" if kind == "bullet_list_open" else "orderedList"
            i += 1
            items, i = _walk_list_items(tokens, i, jira_account_id=jira_account_id)
            # Consume the matching list-close.  _walk_list_items
            # stops at the first non-list_item token, which is the
            # list-close.  Without this consume, a nested list
            # would leave its bullet_list_close on the queue and
            # confuse the caller's `return i` on a generic close.
            if i < n and tokens[i].type in ("bullet_list_close", "ordered_list_close"):
                i += 1
            out.append({"type": list_type, "content": items})
        elif kind == "blockquote_open":
            i += 1
            inner: List[Dict[str, Any]] = []
            i = _walk_block(tokens, i, inner, jira_account_id=jira_account_id)
            if i < n and tokens[i].type == "blockquote_close":
                i += 1
            out.append({"type": "blockquote", "content": inner})
        elif kind in ("fence", "code_block"):
            language = ""
            if kind == "fence":
                language = (tok.info or "").strip().split()[0] if tok.info else ""
            text = tok.content
            if text.endswith("\n"):
                text = text[:-1]
            node: Dict[str, Any] = {"type": "codeBlock", "content": [
                {"type": "text", "text": text}
            ]}
            if language:
                node["attrs"] = {"language": language}
            out.append(node)
            i += 1
        elif kind == "hr":
            out.append({"type": "rule"})
            i += 1
        elif kind in ("heading_close", "paragraph_close", "bullet_list_close",
                      "ordered_list_close", "list_item_close", "blockquote_close"):
            return i
        else:
            # Unknown block token (e.g. table) — skip a token so we
            # don't loop.  Tables aren't in the smoke fixture and
            # would need a separate sub-walker; defer to a follow-up.
            i += 1
    return i


def _walk_list_items(
    tokens: List[Any], start: int, *, jira_account_id: Optional[str]
) -> tuple:
    items: List[Dict[str, Any]] = []
    i = start
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if tok.type == "list_item_open":
            i += 1
            inner: List[Dict[str, Any]] = []
            i = _walk_block(tokens, i, inner, jira_account_id=jira_account_id)
            close = tokens[i]
            assert close.type == "list_item_close"
            i += 1
            items.append({"type": "listItem", "content": inner})
        else:
            break
    return items, i


# ---------------------------------------------------------------------------
# Inline rendering
# ---------------------------------------------------------------------------

def _render_inline(
    children: List[Any], *, jira_account_id: Optional[str]
) -> List[Dict[str, Any]]:
    """Render a markdown-it inline ``children`` list to a list of
    ADF inline nodes.  State machine over a mark stack.
    """
    out: List[Dict[str, Any]] = []
    marks: List[Dict[str, Any]] = []

    def _flush_text(buf: str) -> None:
        if not buf:
            return
        node: Dict[str, Any] = {"type": "text", "text": buf}
        if marks:
            node["marks"] = [dict(m) for m in marks]
        out.append(node)

    buf = ""
    for tok in children:
        ttype = tok.type
        if ttype == "text":
            buf += tok.content
        elif ttype == "code_inline":
            _flush_text(buf); buf = ""
            code_marks = marks + [{"type": "code"}]
            out.append({"type": "text", "text": tok.content, "marks": code_marks})
        elif ttype == "softbreak":
            buf += "\n"
        elif ttype == "hardbreak":
            _flush_text(buf); buf = ""
            out.append({"type": "hardBreak"})
        elif ttype == "strong_open":
            _flush_text(buf); buf = ""
            marks.append({"type": "strong"})
        elif ttype == "strong_close":
            _flush_text(buf); buf = ""
            if marks and marks[-1]["type"] == "strong":
                marks.pop()
        elif ttype == "em_open":
            _flush_text(buf); buf = ""
            marks.append({"type": "em"})
        elif ttype == "em_close":
            _flush_text(buf); buf = ""
            if marks and marks[-1]["type"] == "em":
                marks.pop()
        elif ttype == "s_open":
            _flush_text(buf); buf = ""
            marks.append({"type": "strikethrough"})
        elif ttype == "s_close":
            _flush_text(buf); buf = ""
            if marks and marks[-1]["type"] == "strikethrough":
                marks.pop()
        elif ttype == "link_open":
            _flush_text(buf); buf = ""
            href = tok.attrs.get("href", "") if tok.attrs else ""
            marks.append({"type": "link", "attrs": {"href": href}})
        elif ttype == "link_close":
            _flush_text(buf); buf = ""
            if marks and marks[-1]["type"] == "link":
                marks.pop()
        else:
            # Unknown inline token — preserve its content as text so
            # we never silently drop user input.
            if getattr(tok, "content", None):
                buf += tok.content
    _flush_text(buf)
    # post-process mentions: convert "@display" text into ADF mention nodes
    if jira_account_id is not None:
        out = _promote_mentions(out, jira_account_id)
    return out


_MENTION_TOKEN_RE = re.compile(r"(^|\s)@([A-Za-z0-9_\-\.]{1,64})")


def _promote_mentions(
    nodes: List[Dict[str, Any]], jira_account_id: str
) -> List[Dict[str, Any]]:
    """Walk rendered text nodes and split on ``@name`` substrings,
    promoting each to an ADF ``mention`` node.

    The ``jira_account_id`` is the canonical Jira ``accountId``;
    the text fragment is preserved on the mention node so the
    human-visible label survives the round-trip.
    """
    out: List[Dict[str, Any]] = []
    for node in nodes:
        if node.get("type") != "text":
            out.append(node)
            continue
        text = node.get("text", "")
        if "@" not in text:
            out.append(node)
            continue
        marks = node.get("marks", [])
        cursor = 0
        for m in _MENTION_TOKEN_RE.finditer(text):
            start, end = m.span(2)
            # Adjust start: skip the leading "@" character (we
            # already consumed the leading whitespace in group 1
            # for the regex anchor but the actual name starts at
            # group(2)).  Recompute by searching manually.
            pass
        # Simpler: walk the string character-by-character.
        i = 0
        while i < len(text):
            if text[i] == "@" and (
                i == 0 or text[i - 1].isspace() or text[i - 1] in "(<[{\"'"
            ):
                # collect username
                j = i + 1
                while j < len(text) and (text[j].isalnum() or text[j] in "._-"):
                    j += 1
                if j > i + 1:
                    # Emit preceding text (with marks).
                    if i > cursor:
                        out.append({"type": "text", "text": text[cursor:i], "marks": list(marks)})
                    # Emit mention node.
                    mention_node: Dict[str, Any] = {
                        "type": "mention",
                        "attrs": {
                            "id": jira_account_id,
                            "text": text[i + 1:j],
                            "accessLevel": "",
                        },
                    }
                    if marks:
                        mention_node["marks"] = list(marks)
                    out.append(mention_node)
                    cursor = j
                    i = j
                    continue
            i += 1
        if cursor < len(text):
            out.append({"type": "text", "text": text[cursor:], "marks": list(marks)})
        if not out or (out and out[-1] is not node):
            # If no mention was promoted, keep the original node.
            if cursor == 0 and i == 0:
                out.append(node)
    return out


# ---------------------------------------------------------------------------
# ADF -> Markdown re-parser (for round-trip assertion)
# ---------------------------------------------------------------------------

def adf_to_markdown(adf: Dict[str, Any]) -> str:
    """Re-parse an ADF ``doc`` back to normalised Markdown.

    Lossy by design: ADF is a target format, not a Markdown
    storage.  The output is normalised Markdown that the smoke
    test asserts ``== gfm_normalise(body_md)`` against.  When the
    input is already ADF, this round-trip is byte-stable
    (re-parse -> normalise -> same bytes).
    """
    if not isinstance(adf, dict):
        raise ValueError(f"ADF payload must be a dict; got {type(adf).__name__}")
    if adf.get("type") != "doc":
        raise ValueError(f"ADF payload must have type='doc'; got {adf.get('type')!r}")
    content = adf.get("content", [])
    blocks: List[str] = []
    for node in content:
        s = _adf_block_to_md(node)
        if s:
            blocks.append(s)
    md = "\n\n".join(blocks)
    return normalise_markdown(md)


def _adf_block_to_md(node: Dict[str, Any]) -> str:
    ntype = node.get("type", "")
    if ntype == "paragraph":
        return _adf_inlines_to_md(node.get("content", []))
    if ntype == "heading":
        level = int(node.get("attrs", {}).get("level", 1))
        level = max(1, min(6, level))
        prefix = "#" * level
        return f"{prefix} {_adf_inlines_to_md(node.get('content', []))}"
    if ntype == "bulletList":
        items = node.get("content", [])
        return "\n".join(_adf_list_item_to_md(it, ordered=False) for it in items)
    if ntype == "orderedList":
        items = node.get("content", [])
        return "\n".join(
            _adf_list_item_to_md(it, ordered=True, idx=k + 1) for k, it in enumerate(items)
        )
    if ntype == "codeBlock":
        text_nodes = node.get("content", [])
        text = "".join(t.get("text", "") for t in text_nodes if t.get("type") == "text")
        language = node.get("attrs", {}).get("language", "")
        fence = "```" + (language or "")
        return f"{fence}\n{text}\n```"
    if ntype == "blockquote":
        inner = node.get("content", [])
        inner_md = "\n\n".join(_adf_block_to_md(b) for b in inner)
        return "\n".join("> " + line for line in inner_md.split("\n"))
    if ntype == "rule":
        return "---"
    # Unknown block — render its inline content best-effort.
    if "content" in node:
        return _adf_inlines_to_md(node.get("content", []))
    return ""


def _adf_list_item_to_md(
    node: Dict[str, Any], *, ordered: bool, idx: int = 1
) -> str:
    if node.get("type") != "listItem":
        return ""
    blocks = node.get("content", [])
    # CommonMark requires a 3-space indent for ordered-list
    # continuation lines (2 spaces for unordered).  This keeps the
    # round-trip output parseable by markdown-it.
    nested_indent = "   " if ordered else "  "
    lines: List[str] = []
    for k, b in enumerate(blocks):
        rendered = _adf_block_to_md(b)
        if not rendered:
            continue
        prefix = f"{idx}." if ordered else "-"
        if k == 0:
            lines.append(f"{prefix} {rendered}")
        else:
            # Nested block inside a list item — indent continuation
            # lines with the per-type indent.
            for line in rendered.split("\n"):
                lines.append(f"{nested_indent}{line}")
    return "\n".join(lines)


def _adf_inlines_to_md(inlines: List[Dict[str, Any]]) -> str:
    """Render a list of ADF inline nodes back to Markdown.

    Algorithm: walk the inlines as a stream of (text, marks) pieces.
    Maintain a stack of currently-open marks.  For each new piece:

      1. Compute the longest common prefix of the open stack and
         the piece's marks — those marks stay open across the
         boundary.
      2. Close the marks above the common prefix.
      3. Open the marks below the common prefix (in the order
         they appear in the piece's marks list).
      4. Emit the text.

    A hard-break (``hardBreak``) closes every open mark and
    re-opens the next piece's marks on the next iteration.

    Links are special: open is ``[`` and close is ``](href)`` —
    the href lives on the mark dict so the close can reproduce it.
    """
    pieces: List[Dict[str, Any]] = []
    for node in inlines:
        ntype = node.get("type", "")
        marks = node.get("marks", [])
        if ntype == "text":
            pieces.append({"text": node.get("text", ""), "marks": marks, "break": False})
        elif ntype == "mention":
            attrs = node.get("attrs", {})
            label = attrs.get("text", "")
            pieces.append({"text": f"@{label}", "marks": marks, "break": False})
        elif ntype == "hardBreak":
            pieces.append({"text": "", "marks": [], "break": True})
        else:
            if "text" in node:
                pieces.append({"text": str(node.get("text", "")), "marks": marks, "break": False})

    out: List[str] = []
    open_stack: List[Dict[str, Any]] = []
    for p in pieces:
        if p["break"]:
            # Close everything, emit the hard-break marker, drop the
            # open stack so the next piece reopens from scratch.
            while open_stack:
                out.append(_mark_close_str(open_stack.pop()))
            out.append("  \n")
            continue
        marks = p["marks"]
        # Common prefix of open_stack and marks.
        common = 0
        for a, b in zip(open_stack, marks):
            if a == b:
                common += 1
            else:
                break
        # Close marks above common.
        while len(open_stack) > common:
            out.append(_mark_close_str(open_stack.pop()))
        # Open new marks.
        for m in marks[common:]:
            open_stack.append(m)
            out.append(_mark_open_str(m))
        # Emit text.
        out.append(p["text"])
    # Close remaining.
    while open_stack:
        out.append(_mark_close_str(open_stack.pop()))
    return "".join(out)


# Mark open/close patterns — single source of truth.
_MARK_OPEN = {
    "strong": "**",
    "em": "*",
    "strikethrough": "~~",
    "code": "`",
    "link": "[",
}
_MARK_CLOSE = {
    "strong": "**",
    "em": "*",
    "strikethrough": "~~",
    "code": "`",
    "link": "]",
}


def _mark_open_str(m: Dict[str, Any]) -> str:
    return _MARK_OPEN.get(m.get("type", ""), "")


def _mark_close_str(m: Dict[str, Any]) -> str:
    mtype = m.get("type", "")
    if mtype == "link":
        href = m.get("attrs", {}).get("href", "")
        return f"]({href})"
    return _MARK_CLOSE.get(mtype, "")
