"""
Human-readable rationale generator.

`render_rationale(report)` returns a Markdown document that:
  - Lists the 10 tags in confidence order.
  - Shows the top 3 evidence items per tag.
  - Calls out the cross-graph headline (top tag, time, source).
  - Stays deterministic on the same report (sorted everywhere).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .detector import StyleReport


def _fmt_evidence(ev, max_items: int = 3) -> str:
    pieces = []
    for e in ev[:max_items]:
        bullet = f"  - *{e.kind}* — {e.description}"
        if e.metric and e.value is not None:
            bullet += f" (`{e.metric}` = {e.value:g})"
        if e.paths:
            # Show up to 3 paths inline
            shown = e.paths[:3]
            extra = len(e.paths) - len(shown)
            bullet += "\n    - " + "\n    - ".join(f"`{p}`" for p in shown)
            if extra > 0:
                bullet += f"\n    - … and {extra} more"
        pieces.append(bullet)
    return "\n".join(pieces)


def render_rationale(report: "StyleReport") -> str:
    """Render a Markdown rationale from a `StyleReport`."""
    sorted_tags = sorted(report.tags, key=lambda t: (-t.confidence, t.style))
    top = sorted_tags[0] if sorted_tags else None

    lines: list[str] = []
    lines.append("# Architecture Style Detection — Rationale")
    lines.append("")
    lines.append(f"- **Source graph:** `{report.target_root}` "
                 f"(`schemaVersion={report.schema_version}`, "
                 f"`{report.graph_node_count}` nodes, `{report.graph_edge_count}` edges)")
    lines.append(f"- **Graph generated at:** {report.generated_at}")
    lines.append(f"- **Detector:** `{report.detector_version}` "
                 f"(runtime = {report.detector_runtime_ms} ms, "
                 f"model spend = ${report.cost_usd:.2f})")
    lines.append(f"- **Deterministic:** {'yes' if report.deterministic else 'no'}")
    lines.append("")

    if top is None or top.confidence == 0.0:
        lines.append("> No style scored above 0 — the graph carries no detectable signal.")
        lines.append("")
        return "\n".join(lines)

    lines.append("## Headline")
    lines.append("")
    lines.append(f"**Top tag: `{top.style}` (confidence = {top.confidence:.2f}).**")
    lines.append("")
    lines.append(f"_{top.rationale}_")
    lines.append("")

    lines.append("## Tags (sorted by confidence, descending)")
    lines.append("")
    lines.append("| Style | Confidence | Rationale |")
    lines.append("|-------|-----------:|-----------|")
    for t in sorted_tags:
        rationale_escaped = t.rationale.replace("|", "\\|")
        lines.append(f"| `{t.style}` | {t.confidence:.2f} | {rationale_escaped} |")
    lines.append("")

    lines.append("## Evidence (per tag)")
    lines.append("")
    for t in sorted_tags:
        if not t.evidence:
            continue
        lines.append(f"### `{t.style}` — confidence {t.confidence:.2f}")
        lines.append("")
        lines.append(_fmt_evidence(t.evidence))
        lines.append("")

    lines.append("## Notes")
    lines.append("")
    for n in report.notes:
        lines.append(f"- {n}")
    lines.append("")

    return "\n".join(lines)
