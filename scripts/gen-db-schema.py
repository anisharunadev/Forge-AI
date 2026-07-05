#!/usr/bin/env python3
"""Regenerate docs/reference/db-schema.md from backend/app/db/models/**.

Ponytail: parses each .py with stdlib ast. We extract __tablename__ and
AnnAssign nodes whose value is mapped_column(...). No SQLAlchemy boot, no
subprocess — keeps the doc generator hermetic.

Usage:
    ./scripts/gen-db-schema.py            # rewrite docs/reference/db-schema.md
    ./scripts/gen-db-schema.py --check    # exit 1 if drift
    ./scripts/gen-db-schema.py --dry-run  # print to stdout
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODELS = REPO / "backend" / "app" / "db" / "models"
OUT = REPO / "docs" / "reference" / "db-schema.md"


def _short_type(node: ast.AST | None) -> str:
    """Render an AST type expression as a compact string."""
    if node is None:
        return "?"
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_short_type(node.value)}.{node.attr}"
    if isinstance(node, ast.Call):
        base = _short_type(node.func)
        return f"{base}(...)"
    if isinstance(node, ast.Subscript):
        return f"{_short_type(node.value)}[{_short_type(node.slice)}]"
    if isinstance(node, ast.Constant):
        return repr(node.value)
    return type(node).__name__


def _kwargs_of(call: ast.Call) -> dict[str, ast.AST]:
    out: dict[str, ast.AST] = {}
    for kw in call.keywords:
        if kw.arg is not None:
            out[kw.arg] = kw.value
    return out


def _is_mapped_column_call(value: ast.AST) -> bool:
    # Accept both `mapped_column(...)` (from `from sqlalchemy.orm import
    # mapped_column`) and `orm.mapped_column(...)`. We do not need to be
    # exhaustive — false positives only affect column rendering.
    if not isinstance(value, ast.Call):
        return False
    func = value.func
    if isinstance(func, ast.Name):
        return func.id == "mapped_column"
    if isinstance(func, ast.Attribute):
        return func.attr == "mapped_column"
    return False


def _collect_tablename(stmts: list[ast.stmt]) -> str | None:
    for stmt in stmts:
        if not isinstance(stmt, ast.Assign):
            continue
        for tgt in stmt.targets:
            if (
                isinstance(tgt, ast.Name)
                and tgt.id == "__tablename__"
                and isinstance(stmt.value, ast.Constant)
                and isinstance(stmt.value.value, str)
            ):
                return stmt.value.value
    return None


def _collect_columns(stmts: list[ast.stmt]) -> list[dict]:
    cols: list[dict] = []
    for stmt in stmts:
        if not (isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)):
            continue
        if not _is_mapped_column_call(stmt.value):
            continue
        call = stmt.value
        kw = _kwargs_of(call)
        type_node = call.args[0] if call.args else None
        type_str = _short_type(type_node) if type_node else "?"
        nullable_str = ""
        nullable = kw.get("nullable")
        if isinstance(nullable, ast.Constant):
            nullable_str = "" if nullable.value else " NOT NULL"
        cols.append({
            "name": stmt.target.id,
            "type": type_str,
            "nullable": nullable_str,
        })
    return cols


def collect_models() -> list[dict]:
    models: list[dict] = []
    for py in sorted(MODELS.glob("*.py")):
        if py.name == "__init__.py":
            continue
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except SyntaxError as e:
            print(f"warn: cannot parse {py}: {e}", file=sys.stderr)
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            tablename = _collect_tablename(node.body)
            if tablename is None:
                continue
            models.append({
                "file": py.name,
                "class": node.name,
                "tablename": tablename,
                "cols": _collect_columns(node.body),
            })
    models.sort(key=lambda m: m["tablename"])
    return models


def render(models: list[dict], today: str) -> str:
    by_file: dict[str, list[dict]] = {}
    for m in models:
        by_file.setdefault(m["file"], []).append(m)

    lines = [
        "# Reference: DB Schema (All SQLAlchemy Models)",
        "",
        "<!-- AUTO-GENERATED. DO NOT EDIT. Regenerate via ./scripts/gen-db-schema.py -->",
        "",
        "> **Status:** ✅ Auto-generated",
        "> **Doc owner:** Platform team",
        "> **Source of truth:** `backend/app/db/models/`",
        f"> **Last regenerated:** {today}",
        f"> **Total model files:** {len(by_file)}",
        f"> **Total model classes:** {len(models)}",
        f"> **Total tables:** {len(models)}",
        "",
        "---",
        "",
        "## Purpose",
        "",
        "Canonical inventory of every SQLAlchemy model. For per-feature data",
        "semantics, see `docs/features/<feature>.md`.",
        "",
        "## Conventions",
        "",
        "- Every table has a UUID PK (via `UUIDPrimaryKeyMixin`).",
        "- Every table has `created_at` + `updated_at`.",
        "- Tenant-scoped tables extend `TenantScopedModel` (adds `tenant_id` + `project_id`) and have a composite index.",
        "- Mutable tables extend `SoftDeleteMixin`.",
        "",
        "## Models by table",
        "",
    ]
    for f in sorted(by_file):
        items = by_file[f]
        lines.append(f"### `{f}` — {len(items)} model(s)")
        lines.append("")
        for m in items:
            lines.append(f"#### `{m['tablename']}` (`{m['class']}`)")
            lines.append("")
            if m["cols"]:
                lines.append("| Column | Type | Nullable |")
                lines.append("|---|---|---|")
                for c in m["cols"]:
                    lines.append(f"| `{c['name']}` | `{c['type']}` | {c['nullable'] or 'NULL'} |")
                lines.append("")
            else:
                lines.append("_(no mapped_column statements parsed)_")
                lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"_Generated by `scripts/gen-db-schema.py` on {today}._")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    models = collect_models()
    today = dt.date.today().isoformat()
    body = render(models, today)

    if args.dry_run:
        sys.stdout.write(body)
        return 0

    if args.check:
        if not OUT.exists():
            print(f"::error::{OUT} missing — run ./scripts/gen-db-schema.py", file=sys.stderr)
            return 1
        existing = OUT.read_text(encoding="utf-8")
        if existing != body:
            print(f"::error::{OUT} is stale. Run ./scripts/gen-db-schema.py", file=sys.stderr)
            return 1
        return 0

    OUT.write_text(body, encoding="utf-8")
    files = {m["file"] for m in models}
    print(f"wrote {OUT} ({len(models)} models across {len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
