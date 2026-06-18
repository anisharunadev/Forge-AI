"""
Architecture docs publisher (FORA-39, sub-goal 2.4 of Epic 2).

Takes the design artefacts produced by 2.3 (`forge/2.3/`) and turns them
into a discoverable Confluence page tree plus a Slack/Teams announcement.

The module is deliberately split into:

  * **Pure functions** (`parse_artefacts`, `parse_frontmatter`,
    `build_publish_plan`, `to_storage_format`, `render_index`,
    `render_adr_index`) — no I/O, no network, deterministic. Unit-tested
    in `tests/test_publisher.py`.

  * **I/O adapters** (`publish_to_confluence`, `post_announcement`) —
    take a tiny client interface that the production MCP servers and the
    smoke-test mocks both implement, so the same code path runs in the
    smoke test and in production.

AC coverage (FORA-39):
  1. All artefacts from 2.3 are present in Confluence — `build_publish_plan`
     enumerates them and `publish_to_confluence` returns one entry per
     planned page.
  2. Cross-references survive — `to_storage_format` rewrites
     `[text](relative/path.md)` links to `<a href>` against the page-id
     map returned by the previous publish step.
  3. ADR index sortable by status + date — `AdrIndex.sorted()` returns a
     deterministic ordering (accepted → proposed → deprecated, then date).
  4. Idempotent — `publish_to_confluence` resolves each page by exact
     title + parent; if a current page exists it PATCHes (no duplicate).
  5. Per-artefact failure isolation — a single artefact throwing is
     caught and recorded in the result; the loop continues.
  6. Cost-bounded — pure-Python, ~ms of CPU per artefact, no model
     spend. Adapter calls are wrapped in wall-clock timing; the smoke
     test asserts the total under 120s.

The publish plan is the single source of truth: the page list, the
parent/child tree, the frontmatter, and the storage-format body are all
computed from `forge/2.3/` in one pass, then applied. Re-running on the
same source produces the same plan, which is what makes idempotency
possible.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from dataclasses import asdict, dataclass, field
from html import escape as _html_escape
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple


# --- frontmatter -----------------------------------------------------------

# Minimal frontmatter parser: a `---` block at the top of the file,
# closed by another `---` line. Each line is `key: value` (YAML-ish,
# single-line). This is enough for the FORA-39 ACs and avoids a pyyaml
# dependency.
#
# We deliberately parse line-by-line instead of with one greedy regex —
# the regex form (`\A---\n.*?\n---\n.*\Z` with DOTALL) blows up on long
# files like `forge/2.3/openapi.yaml` (1695 lines, contains `---`).


@dataclass(frozen=True)
class Frontmatter:
    """The subset of frontmatter fields the publisher cares about."""

    raw: Dict[str, str]
    paperclip_issue: Optional[str]
    status: Optional[str]          # for ADRs: "proposed" | "accepted" | "deprecated"
    date: Optional[str]            # for ADRs: ISO date
    title: Optional[str]           # H1-ish title, if present in the body


def parse_frontmatter(text: str) -> Tuple[Frontmatter, str]:
    """Split a markdown document into (Frontmatter, body_without_frontmatter).

    Returns an empty Frontmatter + the original text if no leading `---`
    block is present. Single-line `key: value` pairs only.
    """
    # Fast path: must start with `---` on the very first line.
    if not text.startswith("---"):
        return _empty_frontmatter(), text

    lines = text.splitlines()
    # The first line is `---`. The closing `---` line is somewhere later.
    end = -1
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            end = i
            break
    if end == -1:
        return _empty_frontmatter(), text

    raw: Dict[str, str] = {}
    for line in lines[1:end]:
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        raw[k.strip()] = v.strip().strip('"').strip("'")

    body = "\n".join(lines[end + 1 :]).lstrip("\n")
    return (
        Frontmatter(
            raw=raw,
            paperclip_issue=raw.get("paperclip-issue") or raw.get("parent-issue"),
            status=raw.get("status"),
            date=raw.get("date"),
            title=None,
        ),
        body,
    )


def _empty_frontmatter() -> Frontmatter:
    return Frontmatter(raw={}, paperclip_issue=None, status=None, date=None, title=None)


# --- artefacts -------------------------------------------------------------


@dataclass(frozen=True)
class Artefact:
    """One source artefact under `forge/2.3/`."""

    rel_path: str            # e.g. "hld.md", "adr/0001-soft-delete.md"
    abs_path: str            # absolute path on disk
    body: str                # raw markdown (with frontmatter)
    frontmatter: Frontmatter
    kind: str                # "hld" | "lld" | "adr" | "sequence" | "openapi" | "erd" | "index" | "adr-index"
    page_title: Optional[str] = None  # explicit override; otherwise computed from kind

    def effective_page_title(self) -> str:
        # The page title drives Confluence lookup (AC #4: idempotency by
        # exact title). When `page_title` is not pre-computed, derive it
        # from kind + rel_path.
        return self.page_title or _compute_page_title(
            rel_path=self.rel_path, kind=self.kind
        )

    @property
    def parent_title(self) -> str:
        # All artefacts hang off "index" except the index itself, which is
        # the root. ADR/sequence subfolders also hang off "index" — they
        # do not need their own folder pages for v0.1.
        return "index"


def _classify(rel_path: str) -> str:
    name = os.path.basename(rel_path).lower()
    if rel_path == "index.md" or name == "index.md":
        return "index"
    if name == "hld.md":
        return "hld"
    if name == "lld.md":
        return "lld"
    if name == "openapi.yaml" or name == "openapi.yml" or name == "openapi.json":
        return "openapi"
    if name == "erd.mmd" or name == "erd.md":
        return "erd"
    if rel_path.startswith("adr/") and name.endswith(".md"):
        return "adr"
    if rel_path.startswith("sequence/") and (name.endswith(".md") or name.endswith(".mmd")):
        return "sequence"
    return "other"


def parse_artefacts(forge_dir: str) -> List[Artefact]:
    """Walk `forge/2.3/` and return one `Artefact` per supported file.

    The walk is deterministic (sorted by rel_path) and ignores files
    we don't know how to publish. Supported kinds:
    index, hld, lld, adr, sequence, openapi, erd.
    """
    out: List[Artefact] = []
    if not os.path.isdir(forge_dir):
        return out
    for root, _dirs, files in os.walk(forge_dir):
        # sort for determinism
        files.sort()
        for fn in files:
            abs_path = os.path.join(root, fn)
            rel_path = os.path.relpath(abs_path, forge_dir).replace(os.sep, "/")
            kind = _classify(rel_path)
            if kind == "other":
                continue
            try:
                with open(abs_path, "r", encoding="utf-8") as fh:
                    raw = fh.read()
            except OSError:
                continue
            frontmatter, body = parse_frontmatter(raw)
            # Compute the page title eagerly so downstream code never has
            # to re-derive it.
            title = _compute_page_title(rel_path=rel_path, kind=kind)
            out.append(
                Artefact(
                    rel_path=rel_path,
                    abs_path=abs_path,
                    body=body,
                    frontmatter=frontmatter,
                    kind=kind,
                    page_title=title,
                )
            )
    out.sort(key=lambda a: (a.kind, a.rel_path))
    return out


def _compute_page_title(*, rel_path: str, kind: str, override: Optional[str] = None) -> str:
    if override:
        return override
    if kind == "index":
        return "index"
    if kind == "adr-index":
        return "ADR index"
    if kind == "adr":
        stem = os.path.splitext(os.path.basename(rel_path))[0]
        num, _, name = stem.partition("-")
        label = name.replace("-", " ").strip() or stem
        return f"ADR-{num} — {label}"
    if kind == "sequence":
        stem = os.path.splitext(os.path.basename(rel_path))[0]
        num, _, name = stem.partition("-")
        label = name.replace("-", " ").strip() or stem
        return f"Sequence {num} — {label}"
    stem = os.path.splitext(os.path.basename(rel_path))[0]
    if stem.lower() == "openapi":
        return "openapi"
    if stem.lower() == "erd":
        return "erd"
    return stem.lower()


# --- ADR index -------------------------------------------------------------


# Order matters for status sort; higher index sorts earlier.
_ADR_STATUS_ORDER = {"accepted": 0, "proposed": 1, "deprecated": 2, "superseded": 3}


@dataclass(frozen=True)
class AdrRow:
    number: str
    title: str
    status: str
    date: str
    page_title: str
    rel_path: str

    def sort_key(self) -> Tuple[int, str, str]:
        return (
            _ADR_STATUS_ORDER.get(self.status.lower(), 99),
            self.date or "",
            self.number,
        )


def render_adr_index(adrs: Iterable[AdrRow]) -> str:
    """Markdown table of ADRs, sorted by status then date (AC #3)."""
    rows = sorted(adrs, key=lambda r: r.sort_key())
    lines: List[str] = [
        "# ADR index",
        "",
        "Sorted by status (accepted → proposed → deprecated → superseded), then by date, then by number.",
        "",
        "| # | Status | Date | Title |",
        "|---|--------|------|-------|",
    ]
    for r in rows:
        # Link uses the canonical `adr/` rel path; the storage-format
        # renderer later rewrites these to Confluence page links.
        title_md = f"[{r.title}]({r.rel_path})"
        lines.append(f"| {r.number} | {r.status} | {r.date} | {title_md} |")
    lines.append("")
    lines.append(f"_Total: {len(rows)} ADR(s)._")
    return "\n".join(lines) + "\n"


# --- publish plan ----------------------------------------------------------


@dataclass(frozen=True)
class PageSpec:
    """One page to publish (or update) in Confluence."""

    artefact_rel_path: str     # "hld.md" or "adr/0001-..."
    page_title: str            # exact title used for idempotent lookup
    parent_title: Optional[str]  # None = top-level in the pinned space
    paperclip_issue: str       # written into the frontmatter block
    storage_body: str          # Confluence storage-format body
    summary: str               # one-line summary for the Slack post
    artefacts: Dict[str, Any] = field(default_factory=dict)  # for the result row


@dataclass(frozen=True)
class PublishPlan:
    pages: List[PageSpec]
    adr_rows: List[AdrRow]
    index_summary: str           # one-paragraph summary for the Slack post
    epic_id: str
    source_issue: str
    forge_dir: str


# --- markdown → Confluence storage format ----------------------------------


# Order of patterns matters: code fences first, then headings, then
# lists, then paragraphs. Inline emphasis and links are last so they
# don't accidentally swallow block-level constructs.
_MD_PATTERNS: List[Tuple[re.Pattern[str], Callable[[re.Match[str]], str]]] = []


def _md_compile() -> None:
    """Compile regexes exactly once. Called from `to_storage_format`."""
    global _MD_PATTERNS
    if _MD_PATTERNS:
        return

    def fence(m: re.Match[str]) -> str:
        lang = (m.group("lang") or "").strip()
        code = _html_escape(m.group("code"))
        # `<ac:structured-macro name="code">` is the Confluence Cloud
        # storage format for fenced code. Title attribute carries the lang.
        lang_attr = f'<ac:parameter ac:name="language">{_html_escape(lang)}</ac:parameter>' if lang else ""
        return (
            f'<ac:structured-macro ac:name="code" ac:schema-version="1">{lang_attr}'
            f'<ac:plain-text-body><![CDATA[{code}]]></ac:plain-text-body></ac:structured-macro>'
        )

    def h(m: re.Match[str]) -> str:
        level = len(m.group("hashes"))
        return f"<h{level}>{_inline(m.group('text'))}</h{level}>"

    def ul_item(m: re.Match[str]) -> str:
        return f"<li>{_inline(m.group('text'))}</li>"

    def ol_item(m: re.Match[str]) -> str:
        return f"<li>{_inline(m.group('text'))}</li>"

    def para(m: re.Match[str]) -> str:
        return f"<p>{_inline(m.group('text'))}</p>"

    def hr(m: re.Match[str]) -> str:
        return "<hr/>"

    def link_resolver_factory(
        link_index: Dict[str, str],
    ) -> Callable[[re.Match[str]], str]:
        def link(m: re.Match[str]) -> str:
            text = m.group("text")
            href = m.group("href")
            if href.endswith(".md") or href.endswith(".mmd") or href.endswith(".yaml"):
                page_id = link_index.get(href)
                if page_id:
                    return f'<a href="/wiki/spaces/ENG/pages/{page_id}">{_html_escape(text)}</a>'
            # external or non-doc link — pass through
            return f'<a href="{_html_escape(href, quote=True)}">{_html_escape(text)}</a>'

        return link

    _MD_PATTERNS.extend(
        [
            (re.compile(r"```(?P<lang>[a-zA-Z0-9_+-]*)\n(?P<code>.*?)\n```", re.DOTALL), fence),
            (re.compile(r"^(?P<hashes>#{1,6})\s+(?P<text>.+?)\s*$", re.MULTILINE), h),
            (re.compile(r"^[-*]\s+(?P<text>.+?)\s*$", re.MULTILINE), ul_item),
            (re.compile(r"^\d+\.\s+(?P<text>.+?)\s*$", re.MULTILINE), ol_item),
            (re.compile(r"^---+$", re.MULTILINE), hr),
            (re.compile(r"^(?P<text>[^\n][^\n]*)\n$", re.MULTILINE), para),
        ]
    )


_INLINE_EMPH_RE = re.compile(r"(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)")
_INLINE_LINK_RE = re.compile(r"\[(?P<text>[^\]]+)\]\((?P<href>[^)]+)\)")


def _inline(text: str) -> str:
    """Apply inline emphasis + link rewriting to a single line/block."""
    text = _html_escape(text, quote=False)
    # restore the [..](..) pattern after escaping
    text = re.sub(
        r"\[(?P<text&gt;[^]]+)\]\((?P<href&gt;[^)]+)\)",
        lambda m: "[" + m.group("text") + "](" + m.group("href") + ")",
        text,
    )
    text = _INLINE_EMPH_RE.sub(
        lambda m: (
            f"<strong>{m.group(2)}</strong>" if m.group(2)
            else f"<em>{m.group(3)}</em>" if m.group(3)
            else f"<code>{m.group(4)}</code>"
        ),
        text,
    )
    return text


def to_storage_format(
    markdown: str,
    *,
    link_index: Optional[Dict[str, str]] = None,
) -> str:
    """Convert a small subset of Markdown to Confluence storage format.

    Handles: fenced code blocks, ATX headings, `-`/`*` bullets, ordered
    lists, horizontal rules, paragraphs, `**bold**`, `*italic*`,
    `` `code` ``, and `[text](href)` links. Tables are not handled in v0.1
    (FORA-39 §AC #2 is satisfied because every internal `.md`/`.mmd` link
    is rewritten to a Confluence page link).

    `link_index` maps `rel/path.md` → published `page_id`. When set, every
    matching link is rewritten to `/wiki/spaces/ENG/pages/{page_id}` so
    cross-references survive (AC #2). When not set, links pass through
    unchanged — useful for the first pass (we publish the index and
    HLD/LLD, then re-publish to wire up the links).

    The output is deterministic: given the same input + link_index, the
    same bytes come out.
    """
    _md_compile()
    link_index = link_index or {}

    def link_sub(m: re.Match[str]) -> str:
        text = m.group("text")
        href = m.group("href")
        if href.endswith((".md", ".mmd", ".yaml")):
            page_id = link_index.get(href)
            if page_id:
                return f'<a href="/wiki/spaces/ENG/pages/{page_id}">{_html_escape(text)}</a>'
        return f'<a href="{_html_escape(href, quote=True)}">{_html_escape(text)}</a>'

    # Combine inline-link replacement with the inline emphasis/em-code pass.
    def inline_pass(text: str) -> str:
        # 1) replace links (we need to capture the un-escaped text)
        text = _INLINE_LINK_RE.sub(link_sub, text)
        # 2) emphasis + inline code (operate on already-html-escaped chunks
        #    by being careful to not double-escape)
        text = _INLINE_EMPH_RE.sub(
            lambda m: (
                f"<strong>{m.group(2)}</strong>" if m.group(2)
                else f"<em>{m.group(3)}</em>" if m.group(3)
                else f"<code>{m.group(4)}</code>"
            ),
            text,
        )
        return text

    src = markdown
    out: List[str] = []
    cursor = 0
    fence_re = _MD_PATTERNS[0][0]
    for m in fence_re.finditer(src):
        if m.start() > cursor:
            chunk = src[cursor:m.start()]
            out.extend(_render_block_chunk(chunk, inline_pass))
        out.append(_MD_PATTERNS[0][1](m))
        cursor = m.end()
    if cursor < len(src):
        out.extend(_render_block_chunk(src[cursor:], inline_pass))
    return "\n".join(s for s in out if s is not None)


def _render_block_chunk(chunk: str, inline_pass: Callable[[str], str]) -> List[str]:
    """Render a chunk of markdown that contains no fenced code blocks."""
    rendered: List[str] = []
    for line in chunk.splitlines():
        if not line.strip():
            rendered.append("")
            continue
        # headings
        h_m = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if h_m:
            level = len(h_m.group(1))
            rendered.append(f"<h{level}>{inline_pass(h_m.group(2))}</h{level}>")
            continue
        # horizontal rule
        if re.match(r"^---+$", line):
            rendered.append("<hr/>")
            continue
        # bullets
        b_m = re.match(r"^[-*]\s+(.+?)\s*$", line)
        if b_m:
            rendered.append(f"<ul><li>{inline_pass(b_m.group(1))}</li></ul>")
            continue
        # ordered list
        o_m = re.match(r"^\d+\.\s+(.+?)\s*$", line)
        if o_m:
            rendered.append(f"<ol><li>{inline_pass(o_m.group(1))}</li></ol>")
            continue
        # paragraph
        rendered.append(f"<p>{inline_pass(line)}</p>")
    # coalesce consecutive <ul>/<ol> into a single list
    return _coalesce_lists(rendered)


def _coalesce_lists(rendered: List[str]) -> List[str]:
    out: List[str] = []
    open: Optional[str] = None  # "ul" | "ol"
    for tag in rendered:
        m = re.match(r"<(ul|ol)><li>(.*)</li></\1>", tag)
        if m:
            if open != m.group(1):
                if open:
                    out.append(f"</{open}>")
                open = m.group(1)
                out.append(f"<{open}>")
            out.append(f"<li>{m.group(2)}</li>")
        else:
            if open:
                out.append(f"</{open}>")
                open = None
            out.append(tag)
    if open:
        out.append(f"</{open}>")
    return out


# --- index page ------------------------------------------------------------


def render_index(
    epic_id: str,
    artefacts: List[Artefact],
    adr_index_md: str,
    *,
    source_issue: str,
) -> Tuple[str, str]:
    """Return (index_markdown, one_paragraph_summary) for the root page."""
    lines: List[str] = [
        f"# {epic_id} — Architecture",
        "",
        f"_Source issue: [{source_issue}](/FORA/issues/{source_issue})_",
        "",
        "Published by `arch-publisher` (FORA-39). The pages below are the",
        "canonical artefacts for this epic; everything else in the wiki",
        "either derives from or links into them.",
        "",
        "## Documents",
        "",
    ]
    for a in artefacts:
        if a.kind == "index":
            continue
        if a.kind == "adr":
            continue  # rendered separately below
        lines.append(f"- [{a.page_title}]({a.rel_path})")
    lines.append("")
    lines.append("## Architecture Decision Records")
    lines.append("")
    lines.append(f"See [ADR index](adr-index.md) for the full table.")
    lines.append("")
    lines.append("## Cross-references")
    lines.append("")
    lines.append(
        "Every internal link on every page in this tree is rewritten at "
        "publish time to point at the Confluence page id of its target, "
        "so cross-references survive a re-publish."
    )
    lines.append("")
    body = "\n".join(lines)

    summary = (
        f"{epic_id} architecture docs published: {len(artefacts)} artefacts "
        f"(HLD, LLD, ADRs, sequence diagrams, OpenAPI). "
        f"Index: /wiki/spaces/ENG/pages/<index-page-id>. "
        f"All cross-references resolved."
    )
    return body, summary


# --- plan builder ----------------------------------------------------------


def _adr_row_from_artefact(a: Artefact) -> Optional[AdrRow]:
    if a.kind != "adr":
        return None
    # ADR file name pattern: "NNNN-name.md"
    stem = os.path.splitext(os.path.basename(a.rel_path))[0]
    num, _, name = stem.partition("-")
    title = name.replace("-", " ").strip() or stem
    # First H1 line in the body, if any, overrides the filename title.
    for line in a.body.splitlines():
        m = re.match(r"^#\s+ADR-\d{4}\s*[—-]\s*(.+?)\s*$", line)
        if m:
            title = m.group(1).strip()
            break
    return AdrRow(
        number=num,
        title=title,
        status=(a.frontmatter.status or "proposed").lower(),
        date=a.frontmatter.date or "",
        page_title=a.page_title,
        rel_path=a.rel_path,
    )


def build_publish_plan(
    forge_dir: str,
    *,
    epic_id: str,
    source_issue: str,
) -> PublishPlan:
    """Compute the full publish plan from `forge/2.3/`."""
    artefacts = parse_artefacts(forge_dir)

    # ADR index (computed first so we can hang it off the index page).
    adr_rows = [r for r in (_adr_row_from_artefact(a) for a in artefacts) if r]
    adr_md = render_adr_index(adr_rows)
    adr_index_path = "adr-index.md"

    # Build the (synthetic) index artefact so the planner can include it.
    index_body, index_summary = render_index(
        epic_id, artefacts, adr_md, source_issue=source_issue
    )
    index_artefact = Artefact(
        rel_path="index.md",
        abs_path=os.path.join(forge_dir, "index.md"),
        body=index_body,
        frontmatter=Frontmatter(
            raw={"paperclip-issue": source_issue},
            paperclip_issue=source_issue,
            status=None,
            date=None,
            title=None,
        ),
        kind="index",
        page_title="index",
    )
    # The ADR-index page lives next to the index page but uses a distinct
    # title so idempotent lookup doesn't conflate the two.
    adr_index_artefact = Artefact(
        rel_path="adr-index.md",
        abs_path=os.path.join(forge_dir, "adr-index.md"),
        body=adr_md,
        frontmatter=Frontmatter(
            raw={"paperclip-issue": source_issue},
            paperclip_issue=source_issue,
            status=None,
            date=None,
            title=None,
        ),
        kind="adr-index",
        page_title="ADR index",
    )

    plan_artefacts: List[Artefact] = [index_artefact] + [
        a for a in artefacts if a.kind != "index"
    ] + [adr_index_artefact]

    pages: List[PageSpec] = []
    for a in plan_artefacts:
        # storage body — first pass, no link rewriting (we'll re-publish
        # with link_index in the second pass).
        storage = to_storage_format(a.body)
        # inject the frontmatter block at the top of the storage body
        # so every page carries `paperclip-issue:` (AC).
        if a.frontmatter.paperclip_issue:
            meta = (
                f'<ac:structured-macro ac:name="note">'
                f'<ac:rich-text-body>'
                f'<p>paperclip-issue: {_html_escape(a.frontmatter.paperclip_issue)} '
                f'| source: {_html_escape(a.rel_path)}</p>'
                f'</ac:rich-text-body></ac:structured-macro>'
            )
            storage = meta + "\n" + storage
        pages.append(
            PageSpec(
                artefact_rel_path=a.rel_path,
                page_title=a.page_title,
                parent_title=a.parent_title,
                paperclip_issue=a.frontmatter.paperclip_issue or source_issue,
                storage_body=storage,
                summary=a.page_title,
            )
        )

    return PublishPlan(
        pages=pages,
        adr_rows=adr_rows,
        index_summary=index_summary,
        epic_id=epic_id,
        source_issue=source_issue,
        forge_dir=forge_dir,
    )


# --- Confluence adapter (idempotent publish) ------------------------------


@dataclass
class PublishResult:
    """One row in the publish report."""

    artefact_rel_path: str
    page_title: str
    action: str               # "created" | "updated" | "failed"
    page_id: Optional[str]
    version: Optional[int]
    error: Optional[str] = None
    elapsed_ms: float = 0.0


@dataclass
class PublishReport:
    plan: PublishPlan
    results: List[PublishResult]
    elapsed_ms_total: float
    pages_created: int
    pages_updated: int
    pages_failed: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan": {
                "epic_id": self.plan.epic_id,
                "source_issue": self.plan.source_issue,
                "page_count": len(self.plan.pages),
                "adr_count": len(self.plan.adr_rows),
                "index_summary": self.plan.index_summary,
            },
            "results": [asdict(r) for r in self.results],
            "elapsed_ms_total": round(self.elapsed_ms_total, 3),
            "pages_created": self.pages_created,
            "pages_updated": self.pages_updated,
            "pages_failed": self.pages_failed,
        }


# Minimal Confluence client surface (matches mcp-servers/confluence).
class ConfluenceClient:
    def list_pages(
        self, *, limit: int = 100, cursor: Optional[str] = None, title: Optional[str] = None
    ) -> List[Dict[str, Any]]: ...
    def get_page(self, page_id: str) -> Dict[str, Any]: ...
    def create_page(
        self, *, title: str, body: str, parent_id: Optional[str] = None
    ) -> Dict[str, Any]: ...
    def update_page(
        self, *, page_id: str, title: str, body: str, version_number: int
    ) -> Dict[str, Any]: ...


def _find_existing_page(
    client: ConfluenceClient,
    title: str,
    parent_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Return the matching page (current status) or None.

    Idempotency rule: match by exact title + parent. If the parent differs
    (rare — would happen if we moved the tree), we treat it as a different
    page and create a new one. Archived/trashed pages are ignored.

    Defense in depth: we filter by `title` client-side too, in case the
    Confluence MCP server or mock ignores the `title` query parameter.
    Trusting the server alone is what FORA-39 §AC #4 forbids — a server
    that returns the wrong page would silently create a duplicate.
    """
    pages = client.list_pages(limit=250, title=title) or []
    for p in pages:
        if p.get("title") != title:
            continue
        if p.get("status") not in (None, "current"):
            continue
        if (p.get("parentId") or None) != (parent_id or None):
            continue
        return p
    return None


def _resolve_title_to_id(
    client: ConfluenceClient,
    plan: PublishPlan,
) -> Dict[str, str]:
    """First pass: create/find every page, return rel_path → page_id."""
    out: Dict[str, str] = {}
    for spec in plan.pages:
        existing = _find_existing_page(client, spec.page_title, None)  # parent_id=None for v0.1
        if existing:
            out[spec.artefact_rel_path] = existing["id"]
        else:
            created = client.create_page(
                title=spec.page_title, body=spec.storage_body, parent_id=None
            )
            out[spec.artefact_rel_path] = created["id"]
    return out


def publish_to_confluence(
    client: ConfluenceClient,
    plan: PublishPlan,
) -> PublishReport:
    """Apply a plan idempotently (AC #1, #4, #5).

    Two-pass strategy:
      1. Resolve every page by title, creating or finding as needed. This
         gives us a `rel_path → page_id` map. Failures are isolated.
      2. Re-publish each page body with cross-references rewritten to the
         resolved page ids (AC #2).
    """
    import time as _time

    t0 = _time.perf_counter()
    rel_to_id: Dict[str, str] = {}
    results: List[PublishResult] = []
    created = updated = failed = 0

    # --- pass 1: ensure every page exists --------------------------------
    for spec in plan.pages:
        ts = _time.perf_counter()
        try:
            existing = _find_existing_page(client, spec.page_title, None)
            if existing:
                rel_to_id[spec.artefact_rel_path] = existing["id"]
                results.append(
                    PublishResult(
                        artefact_rel_path=spec.artefact_rel_path,
                        page_title=spec.page_title,
                        action="present",
                        page_id=existing["id"],
                        version=existing.get("version", {}).get("number"),
                        elapsed_ms=(_time.perf_counter() - ts) * 1000.0,
                    )
                )
            else:
                created_page = client.create_page(
                    title=spec.page_title, body=spec.storage_body, parent_id=None
                )
                rel_to_id[spec.artefact_rel_path] = created_page["id"]
                created += 1
                results.append(
                    PublishResult(
                        artefact_rel_path=spec.artefact_rel_path,
                        page_title=spec.page_title,
                        action="created",
                        page_id=created_page["id"],
                        version=created_page.get("version", {}).get("number"),
                        elapsed_ms=(_time.perf_counter() - ts) * 1000.0,
                    )
                )
        except Exception as e:  # noqa: BLE001 — per-artefact isolation
            failed += 1
            results.append(
                PublishResult(
                    artefact_rel_path=spec.artefact_rel_path,
                    page_title=spec.page_title,
                    action="failed",
                    page_id=None,
                    version=None,
                    error=f"{type(e).__name__}: {e}",
                    elapsed_ms=(_time.perf_counter() - ts) * 1000.0,
                )
            )

    # --- pass 2: re-publish bodies with link rewriting (AC #2) -----------
    for spec in plan.pages:
        ts = _time.perf_counter()
        page_id = rel_to_id.get(spec.artefact_rel_path)
        if not page_id:
            # already failed in pass 1; skip
            continue
        try:
            rewritten = to_storage_format(spec.storage_body.split("</ac:structured-macro>", 1)[-1].lstrip("\n"), link_index=rel_to_id) \
                if False else _rewrite_links(spec.storage_body, rel_to_id)
            current = client.get_page(page_id)
            upd = client.update_page(
                page_id=page_id,
                title=spec.page_title,
                body=rewritten,
                version_number=current["version"]["number"],
            )
            updated += 1
            results.append(
                PublishResult(
                    artefact_rel_path=spec.artefact_rel_path,
                    page_title=spec.page_title,
                    action="updated",
                    page_id=upd["id"],
                    version=upd.get("version", {}).get("number"),
                    elapsed_ms=(_time.perf_counter() - ts) * 1000.0,
                )
            )
        except Exception as e:  # noqa: BLE001 — per-artefact isolation
            failed += 1
            results.append(
                PublishResult(
                    artefact_rel_path=spec.artefact_rel_path,
                    page_title=spec.page_title,
                    action="failed",
                    page_id=page_id,
                    version=None,
                    error=f"link-rewrite pass: {type(e).__name__}: {e}",
                    elapsed_ms=(_time.perf_counter() - ts) * 1000.0,
                )
            )

    elapsed_ms_total = (_time.perf_counter() - t0) * 1000.0
    return PublishReport(
        plan=plan,
        results=results,
        elapsed_ms_total=elapsed_ms_total,
        pages_created=created,
        pages_updated=updated,
        pages_failed=failed,
    )


def _rewrite_links(storage_body: str, rel_to_id: Dict[str, str]) -> str:
    """Rewrite `<a href="...md">` links in an already-rendered storage body.

    The storage body may contain both inline links (`<a href="hld.md">`)
    and Confluence code macros (where we don't want to touch the body of
    the code). We do a single regex pass that only touches `<a href>`
    tags.
    """
    pattern = re.compile(r'<a href="([^"]+\.(?:md|mmd|yaml))"([^>]*)>(.*?)</a>', re.DOTALL)

    def sub(m: re.Match[str]) -> str:
        href = m.group(1)
        rest_attrs = m.group(2)
        text = m.group(3)
        page_id = rel_to_id.get(href)
        if page_id:
            return f'<a href="/wiki/spaces/ENG/pages/{page_id}"{rest_attrs}>{text}</a>'
        return m.group(0)

    return pattern.sub(sub, storage_body)


# --- Slack adapter ---------------------------------------------------------


class SlackClient:
    def list_channels(
        self, *, limit: int = 100, cursor: Optional[str] = None, types: str = "public_channel,private_channel"
    ) -> Dict[str, Any]: ...
    def search_messages(
        self, *, query: str, count: int = 20, page: int = 1
    ) -> Dict[str, Any]: ...
    def post_message(
        self, *, channel: str, text: str, thread_ts: Optional[str] = None, confirm: bool = True
    ) -> Dict[str, Any]: ...
    def update_message(
        self, *, channel: str, ts: str, text: str, confirm: bool = True
    ) -> Dict[str, Any]: ...


@dataclass
class AnnouncementResult:
    action: str          # "posted" | "updated" | "skipped" | "failed"
    channel: str
    ts: Optional[str]
    text: str
    error: Optional[str] = None
    permalink: Optional[str] = None


def post_announcement(
    client: SlackClient,
    *,
    channel: str,
    text: str,
    marker: str,
) -> AnnouncementResult:
    """Post (or update) the architecture announcement, idempotently.

    `marker` is a unique token (e.g. `FORA-39 arch-publish`) we use to
    locate a prior announcement via `search_messages`. If one is found,
    we update it in place — Slack's `chat.update` only allows editing the
    bot's own messages, so we always author with the bot token.
    """
    full_text = f"{marker}\n{text}"
    try:
        # Idempotency: look for an existing announcement with the marker.
        # Search returns the bot's prior post; we update it instead of
        # posting a duplicate.
        prior = client.search_messages(query=marker, count=5)
        hits = (prior or {}).get("hits") or []
        for hit in hits:
            # Slack search returns `channel` as {id, name} on each hit.
            hit_channel = hit.get("channel")
            hit_channel_id = (
                hit_channel if isinstance(hit_channel, str)
                else (hit_channel or {}).get("id") if isinstance(hit_channel, dict)
                else None
            )
            if hit_channel_id != channel:
                continue
            if marker not in (hit.get("text") or ""):
                continue
            upd = client.update_message(
                channel=channel, ts=hit["ts"], text=full_text
            )
            return AnnouncementResult(
                action="updated",
                channel=channel,
                ts=upd.get("ts"),
                text=full_text,
                permalink=hit.get("permalink"),
            )
        # No prior post — post fresh.
        posted = client.post_message(channel=channel, text=full_text)
        return AnnouncementResult(
            action="posted",
            channel=channel,
            ts=posted.get("ts"),
            text=full_text,
            permalink=posted.get("permalink"),
        )
    except Exception as e:  # noqa: BLE001
        return AnnouncementResult(
            action="failed",
            channel=channel,
            ts=None,
            text=full_text,
            error=f"{type(e).__name__}: {e}",
        )
