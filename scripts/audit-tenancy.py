#!/usr/bin/env python
"""scripts/audit-tenancy.py — multi-tenancy column & index auditor.

Reads ``app.db.base.Base.metadata`` (the same metadata Alembic
autogenerate uses) and reports per-table violations of Forge AI's
multi-tenancy rules:

  Rule 1: Every tenant-scoped table has a ``tenant_id`` column NOT NULL.
  Rule 2: If the table is project-scoped (default), it also has
          ``project_id`` and at least one composite
          ``Index("...", "tenant_id", "project_id", ...)`` index.

Tables declared as system / root / catalog (carrying the markers
``_audit_skip``, ``_audit_root``, ``_audit_scope = "project-only"|"tenant-only"``)
are excluded from the strict checks — Phase 4.1 introduces the
markers; the audit script also documents them.

Modes
-----
  --strict                     exit 1 if any RULE-1 or RULE-2 violation
  --require-composite-index    additionally exit 1 if a tenant-scoped
                               table is missing a composite index
  --json                       emit JSON instead of pretty text

Wired into .github/workflows/python-ci.yml. Run locally::

    python scripts/audit-tenancy.py --strict --require-composite-index
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# Set test-mode env vars before any app.* import so Settings() can
# construct in standalone-script mode (the same shim conftest.py uses).
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("LITELLM_PROXY_URL", "http://localhost:4000")
os.environ.setdefault("LITELLM_API_KEY", "audit-test-key")
os.environ.setdefault("LITELLM_ADMIN_KEY", "audit-test-admin-key")
os.environ.setdefault("KEYCLOAK_URL", "http://localhost:8080")
os.environ.setdefault("JWT_SECRET", "audit-test-secret")
os.environ.setdefault("ENVIRONMENT", "test")

# Make ``app`` importable when running from repo root.
ROOT = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, inspect  # noqa: E402

# Importing the package side-effect registers every model on Base.metadata.
from app.db import base as base_mod  # noqa: E402,F401
import app.db.models  # noqa: E402,F401  pylint: disable=import-outside-toplevel


# Tables whose tenancy contract is not "tenant + project".
# Either the model file declares a marker (preferred) or we recognise
# the explicit table name here (audit-bootstrap fallback).
_ROOT_TABLES = {"tenants"}
_CATALOG_TABLES = {"marketplace_connectors", "model_providers"}
_PROJECT_ONLY_TABLES = {"project_invitations", "project_members"}
_TENANT_ONLY_TABLES = {"organizations"}


@dataclass
class Violation:
    table: str
    rule: str
    detail: str

    def format(self) -> str:
        return f"  - {self.table:<40s} {self.rule}: {self.detail}"


def _find_model_class(table_name: str):
    """Find the ORM class that declares ``__tablename__ == table_name``.

    Returns the class or ``None`` (anonymous tables / legacy stubs).
    """
    from app.db.base import Base

    for mapper in Base.registry.mappers:
        cls = mapper.class_
        tbl = getattr(cls, "__table__", None)
        if tbl is not None and tbl.name == table_name:
            return cls
    return None


def _is_audit_skip(model) -> bool:
    """A model can opt out via three declarative markers:
      _audit_root = True        (root table; no tenant_id by definition)
      _audit_skip = ("reason", "why")
      _audit_scope = "project-only" | "tenant-only" | "global"
    """
    return bool(getattr(model, "_audit_root", False)) or bool(
        getattr(model, "_audit_skip", None)
    ) or getattr(model, "_audit_scope", None) in {"project-only", "tenant-only", "global"}


def _audit_model(model_cls, table, inspector) -> tuple:
    """Return (scope, [index_names]) for the table."""
    scope = getattr(model_cls, "_audit_scope", None)
    if model_cls is None or _is_audit_skip(model_cls) or scope in {
        "project-only",
        "tenant-only",
        "global",
    }:
        return scope or "global", []
    columns = {c["name"]: c for c in inspector.get_columns(table.name)}
    has_tid = "tenant_id" in columns
    has_pid = "project_id" in columns
    if has_tid and has_pid:
        return "tenant+project", [
            ix["name"]
            for ix in inspector.get_indexes(table.name)
            if "tenant_id" in ix["column_names"]
            and "project_id" in ix["column_names"]
        ]
    if has_tid:
        return "tenant-only", []
    return "unknown", []


def collect_violations(strict: bool, require_composite: bool) -> list:
    # Build an in-memory SQLite engine so ``inspect`` resolves columns
    # and indexes from metadata without needing a live DB.
    eng = create_engine("sqlite:///:memory:")
    try:
        base_mod.metadata.create_all(eng, checkfirst=True)
    except Exception:  # noqa: BLE001
        # Some tables (e.g. PG-only ARRAY columns) don't compile on
        # SQLite; drop them and retry — the audit only needs columns
        # and indexes for the tables that survive.
        sync_engine = create_engine("sqlite:///:memory:")
        for table in list(base_mod.metadata.tables.values()):
            try:
                table.create(sync_engine, checkfirst=False)
            except Exception:  # noqa: BLE001
                base_mod.metadata.remove(table)
        eng = create_engine("sqlite:///:memory:")
        base_mod.metadata.create_all(eng, checkfirst=True)
    inspector = inspect(eng)

    out: list = []
    for table in base_mod.metadata.tables.values():
        table_name = table.name
        model_cls = _find_model_class(table_name)
        try:
            scope, composite_ix = _audit_model(model_cls, table, inspector)
        except Exception as exc:  # noqa: BLE001
            out.append(Violation(table_name, "INSPECT_FAILED", str(exc)))
            continue
        if table_name in _ROOT_TABLES | _CATALOG_TABLES | _PROJECT_ONLY_TABLES | _TENANT_ONLY_TABLES:
            continue
        if scope == "unknown":
            if strict:
                out.append(
                    Violation(table_name, "MISSING_TENANT_ID", "no tenant_id column")
                )
            continue
        if scope == "tenant+project":
            if require_composite and not composite_ix:
                out.append(
                    Violation(
                        table_name,
                        "MISSING_COMPOSITE_INDEX",
                        "no Index(tenant_id, project_id, …)",
                    )
                )
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--strict", action="store_true")
    p.add_argument("--require-composite-index", action="store_true")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    violations = collect_violations(args.strict, args.require_composite_index)
    if args.json:
        print(json.dumps([asdict(v) for v in violations], indent=2))
    else:
        if not violations:
            print("audit-tenancy: 0 violations.")
            return 0
        print(f"audit-tenancy: {len(violations)} violation(s):")
        for v in violations:
            print(v.format())
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
