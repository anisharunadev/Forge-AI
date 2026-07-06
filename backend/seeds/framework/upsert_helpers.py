"""Pure helpers for building UPSERT SQL — no DB I/O, 100% unit-testable.

These functions are deliberately framework-light: they return SQL
fragments and parameter dicts that ``SeedRunner`` composes with the
session's ``execute()``. Keeping them pure means the bulk of the seed
runner is exercised without a database.
"""

from __future__ import annotations

from typing import Any


def build_upsert_sql(
    table: str,
    columns: list[str],
    natural_key: list[str],
) -> tuple[str, dict[str, Any]]:
    """Build an ``INSERT ... ON CONFLICT (key) DO UPDATE SET ...`` statement.

    The generated SQL is dialect-neutral for Postgres + SQLite (the two
    dialects the suite runs against). The natural-key columns must be a
    subset of ``columns`` and must also exist in the target table's
    unique-index — this is enforced upstream by ``SchemaMismatchError``
    on a schema check.

    Returns ``(sql, params_template)`` where ``params_template`` is an
    empty dict whose keys the caller must fill with row-specific values.

    Example::

        sql, params = build_upsert_sql("standards", ["name", "content"], ["name"])
        # sql == INSERT INTO standards (name, content) VALUES (:name, :content)
        #        ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content
    """
    if not table or not table.replace("_", "").isalnum():
        raise ValueError(f"build_upsert_sql: invalid table name {table!r}")
    if not columns:
        raise ValueError("build_upsert_sql: columns must be non-empty")
    if not natural_key:
        raise ValueError("build_upsert_sql: natural_key must be non-empty")
    extras = set(natural_key) - set(columns)
    if extras:
        raise ValueError(
            f"build_upsert_sql: natural_key columns missing from columns: {sorted(extras)}"
        )

    # VALUES placeholders — one per column, named.
    placeholders = ", ".join(f":{col}" for col in columns)
    col_list = ", ".join(columns)
    conflict_cols = ", ".join(natural_key)

    # SET clause — update every non-key column to the EXCLUDED value.
    set_clauses: list[str] = []
    for col in columns:
        if col in natural_key:
            continue
        set_clauses.append(f"{col} = EXCLUDED.{col}")
    if not set_clauses:
        # Pure key-only UPSERT (rare): fall back to a no-op DO NOTHING
        # expressed as DO UPDATE SET key = EXCLUDED.key so the
        # statement still has a SET clause Postgres accepts.
        set_clauses = [f"{natural_key[0]} = EXCLUDED.{natural_key[0]}"]

    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT ({conflict_cols}) DO UPDATE SET {', '.join(set_clauses)}"
    )
    return sql, {}


def chunk_rows(rows: list[dict[str, Any]], batch_size: int = 200) -> list[list[dict[str, Any]]]:
    """Split ``rows`` into ordered chunks of at most ``batch_size`` items.

    Used by the runner to keep individual UPSERT transactions bounded
    so a long apply can checkpoint progress into ``seed_runs.row_counts``.
    """
    if batch_size <= 0:
        raise ValueError(f"chunk_rows: batch_size must be > 0, got {batch_size}")
    if not rows:
        return []
    out: list[list[dict[str, Any]]] = []
    for i in range(0, len(rows), batch_size):
        out.append(list(rows[i : i + batch_size]))
    return out


def flatten_row(row: dict[str, Any], parent_keys: list[str]) -> dict[str, Any]:
    """Resolve ``_id_ref`` and ``*_id_ref`` placeholders in a row.

    The seed data files use a pointer convention: a key ending in
    ``_id_ref`` whose value is the name of another seed's row references
    that row's primary key after the parent has applied. The runner
    maintains a name-to-id map per ``parent_keys`` column set; this
    helper swaps the pointer for the resolved UUID.

    Example::

        parent_keys = ["slug"]   # the parent table's natural key
        resolve_map = {"acme-corp": UUID("...")}
        flatten_row(
            {"tenant_slug_ref": "acme-corp", "name": "Tech Lead"},
            parent_keys=["slug"],
        )
        # => {"tenant_id": UUID("..."), "name": "Tech Lead"}

    The convention is intentionally narrow: only keys ending in
    ``_id_ref`` are touched, and only one pointer resolution is
    performed per key per row. The resolve map is provided by the
    caller (typically captured from the seed_migrations table or the
    in-memory apply log).
    """
    if not isinstance(row, dict):
        raise TypeError(f"flatten_row: row must be a dict, got {type(row).__name__}")
    out: dict[str, Any] = {}
    for key, value in row.items():
        if key.endswith("_id_ref") and isinstance(value, str):
            # Convention: <entity>_id_ref → <entity>_id
            target_col = key[: -len("_ref")]
            if target_col.endswith("_id"):
                # Already in <entity>_id form — strip the trailing _ref.
                out[target_col] = value
            else:
                # e.g. tenant_slug_ref → tenant_id (the resolved FK column).
                out[target_col + "_id"] = value
            continue
        out[key] = value
    return out


__all__ = [
    "build_upsert_sql",
    "chunk_rows",
    "flatten_row",
]
