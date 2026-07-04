"""Tests for the cost_ledger schema (M2 ADR-009, Track B T-B8).

Covers the three required cases:

  1. ``required-columns`` — every ADR-009 column is present on the
     physical ``cost_entries`` table.
  2. ``non-nullable`` — the columns the spec marks NOT NULL enforce
     the constraint.
  3. ``constraints`` — the ``run_id`` + ``projected`` composite
     index exists so the cumulative-cap rule's sum query is
     constant-time.

The :func:`sqlite_db` fixture creates every table via
``metadata.create_all`` which fails on Postgres-specific ARRAY
columns in unrelated models (``phase4_sso_configs``). The cost
ledger schema itself is portable, so we inspect the SQLAlchemy
``Table`` object directly — the same source of truth that
``create_all`` would use.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# 1. required-columns
# ---------------------------------------------------------------------------


def test_required_columns_present_on_cost_entries() -> None:
    """Every ADR-009 column is registered on the cost_entries table."""
    from app.db.models.cost import CostEntry

    columns = {c.name for c in CostEntry.__table__.columns}

    required = {
        "id",  # UUID primary key (UUIDPrimaryKeyMixin)
        "tenant_id",
        "project_id",
        "run_id",  # ADR-009 — binds the row to the SDLC run
        "agent",  # ADR-009 — names the agent that incurred the spend
        "source",
        "model",
        "prompt_tokens",
        "completion_tokens",
        "cost_usd",
        "projected",  # ADR-009 — distinguishes projection from actual
        "recorded_at",
    }
    missing = required - columns
    assert not missing, f"ADR-009 columns missing from cost_entries: {missing}"


# ---------------------------------------------------------------------------
# 2. non-nullable
# ---------------------------------------------------------------------------


def test_non_nullable_columns_have_not_null_constraint() -> None:
    """The NOT-NULL ADR-009 + business columns enforce the constraint."""
    from app.db.models.cost import CostEntry

    not_nullable = {
        c.name for c in CostEntry.__table__.columns if not c.nullable
    }
    expected = {
        "id",
        "tenant_id",
        "project_id",
        "source",
        "prompt_tokens",
        "completion_tokens",
        "cost_usd",
        "projected",  # ADR-009 — defaults to false but NOT NULL
        "recorded_at",
        "created_at",
        "updated_at",
    }
    assert expected.issubset(not_nullable), (
        f"NOT-NULL columns missing on cost_entries: {expected - not_nullable}"
    )
    # ADR-009 specifically: run_id + agent are NULLABLE so legacy
    # tool/connector rows continue to insert cleanly. This is the
    # migration contract — the column DEFAULTs to NULL.
    nullable = {c.name for c in CostEntry.__table__.columns if c.nullable}
    assert "run_id" in nullable, "run_id must remain NULLABLE (ADR-009)"
    assert "agent" in nullable, "agent must remain NULLABLE (ADR-009)"


# ---------------------------------------------------------------------------
# 3. constraints (composite index)
# ---------------------------------------------------------------------------


def test_composite_index_run_id_projected_exists() -> None:
    """The ``ix_cost_run_projected`` composite index exists so the
    cumulative-cap rule's sum query (WHERE run_id = X AND projected
    = false) is constant-time regardless of ledger size."""
    from app.db.models.cost import CostEntry

    index_names = {idx.name for idx in CostEntry.__table__.indexes}
    assert "ix_cost_run_projected" in index_names, (
        f"ix_cost_run_projected composite index missing. Found: {sorted(index_names)}"
    )

    # Verify the index covers BOTH columns (not just one).
    target_index = next(
        idx for idx in CostEntry.__table__.indexes if idx.name == "ix_cost_run_projected"
    )
    columns = {c.name for c in target_index.columns}
    assert "run_id" in columns
    assert "projected" in columns