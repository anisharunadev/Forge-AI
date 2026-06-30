# Standard: Data Model

> **Status:** ✅ Canonical — every SQLAlchemy model in Forge follows these patterns
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/db/` + `backend/app/db/models/base.py`
> **Last updated:** 2026-06-30

---

## Purpose

Forge is a multi-tenant, audit-tracked, soft-delete-by-default database. Every table shares a common foundation: UUID PK, tenant scoping, timestamps, and immutable audit. This document codifies the **model patterns** that keep data consistent across 60+ tables.

---

## Source of truth

- **This file** — `/workspace/docs/standards/data-model.md`
- **Base mixins** — `backend/app/db/models/base.py` (`TenantScopedModel`, `SoftDeleteMixin`, `TimestampMixin`, `UUIDPrimaryKeyMixin`)
- **Migration directory** — `backend/app/db/migrations/versions/`
- **Model inventory** — `/workspace/docs/reference/db-schema.md`
- **All models** — `backend/app/db/models/`

---

## 1. The mixins (4 foundational mixins)

### 1.1 — `UUIDPrimaryKeyMixin`

Every table uses a UUID PK (not auto-increment integers). UUIDs:
- Don't leak row counts (security)
- Can be generated client-side (mobile offline writes)
- Merge cleanly across regions / multi-tenant scenarios

```python
class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(
        GUID(),  # cross-DB UUID type
        primary_key=True,
        default=uuid4,  # server-side default
        server_default=text("gen_random_uuid()"),  # DB-side default
    )
```

**Why both `default` and `server_default`:** Python-side default avoids a DB roundtrip; DB-side default catches direct SQL inserts.

### 1.2 — `TimestampMixin`

Every table has `created_at` + `updated_at`. Audit queries depend on these.

```python
class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),  # auto-update on UPDATE
    )
```

**Always `timezone=True`.** Naive datetimes are a bug factory.

### 1.3 — `TenantScopedModel`

Every tenant-aware table inherits tenant_id + project_id. **Adding this mixin without an RLS policy is a code review blocker.**

```python
class TenantScopedModel:
    """Mixin that adds tenant_id + project_id columns.

    Tables using this mixin are auto-scoped by RLS via the session's
    GUC. Adding this mixin without also adding an RLS policy is a
    code review blocker.
    """
    tenant_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        GUID(),
        ForeignKey("projects.id"),
        nullable=True,  # nullable for org-scoped records (rare)
        index=True,
    )
```

**When to use:**
- Per-tenant data (stories, workflows, runs, agents)
- Per-tenant configs (LLM virtual keys, connector configs)

**When NOT to use:**
- Org Knowledge (curated standards, shared across tenants) — see R5

### 1.4 — `SoftDeleteMixin`

Tables use soft delete by default. Hard delete only for GDPR / right-to-be-forgotten.

```python
class SoftDeleteMixin:
    """Soft-delete columns. Add to any table that should support
    recoverable deletion. Pairs with the `deleted_at IS NULL` filter
    in queries (auto-applied by TenantScopedSession for tenant-scoped
    tables)."""
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    deleted_by: Mapped[UUID | None] = mapped_column(
        GUID(), nullable=True, default=None
    )
```

**Soft delete pattern:**

```python
# ❌ Hard delete
await db.execute(delete(Story).where(Story.id == story_id))

# ✅ Soft delete (preserves audit trail)
await db.execute(
    update(Story)
    .where(Story.id == story_id)
    .values(
        deleted_at=datetime.now(timezone.utc),
        deleted_by=principal.actor_id,
    )
)
```

---

## 2. Model composition

### 2.1 — Standard model shape

Every model follows this composition:

```python
class Story(
    TenantScopedModel,    # tenant_id + project_id
    Base,                  # SQLAlchemy declarative base
    UUIDPrimaryKeyMixin,   # id (UUID)
    TimestampMixin,        # created_at + updated_at
    SoftDeleteMixin,       # deleted_at + deleted_by
):
    __tablename__ = "stories"

    # Columns (use Mapped[T] 2.0 style)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)

    # Foreign keys
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # JSON columns for flexible payloads
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",  # SQL column name (Python attr is metadata_ to avoid SQLAlchemy conflict)
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    # Relationships (lazy loading by default)
    project: Mapped["Project"] = relationship(back_populates="stories")

    # Indexes
    __table_args__ = (
        Index("ix_stories_tenant_project", "tenant_id", "project_id"),
        Index("ix_stories_tenant_status", "tenant_id", "status"),
    )
```

### 2.2 — Naming conventions

| Entity | Convention | Example |
|---|---|---|
| Table names | plural snake_case | `stories`, `migration_plans`, `seed_runs` |
| Column names | singular snake_case | `title`, `created_at`, `tenant_id` |
| Foreign keys | `<table_singular>_id` | `project_id`, `tenant_id` |
| Index names | `ix_<table>_<columns>` | `ix_stories_tenant_status` |
| Enum values | lowercase snake_case | `in_progress`, `awaiting_approval` |
| JSON keys | snake_case | `{"created_at": ..., "display_name": ...}` |

### 2.3 — JSON / JSONB columns

For semi-structured payloads (metadata, settings, search index snapshots):

```python
settings: Mapped[dict[str, Any]] = mapped_column(
    JSONB,
    nullable=False,
    default=dict,
    server_default=text("'{}'::jsonb"),
)
```

**Use JSONB, not JSON.** JSONB is binary + indexable + faster.

**Always default to `{}` (empty dict), never `None`.** This simplifies query logic (`obj.settings.get(...)` always works).

---

## 3. Indexes

### 3.1 — Required indexes

```python
class Story(...):
    # Single-column indexes (on FKs + commonly-queried columns)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("tenants.id"), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)

    # Composite indexes (for multi-column WHERE clauses)
    __table_args__ = (
        Index("ix_stories_tenant_project", "tenant_id", "project_id"),
        Index("ix_stories_tenant_status", "tenant_id", "status"),
        Index("ix_stories_tenant_status_updated", "tenant_id", "status", "updated_at"),
    )
```

**Naming convention:** `ix_<table>_<col1>[_<col2>...]`

### 3.2 — When to add an index

- Every FK
- Every column in WHERE clauses
- Every column in ORDER BY clauses
- Every column in GROUP BY clauses

**Don't add indexes on:**
- Boolean columns (low selectivity)
- Short string columns (< 10 chars) unless unique
- Columns with very high cardinality + low query frequency

### 3.3 — Partial indexes (for filtered queries)

```python
Index(
    "ix_stories_active_only",
    "tenant_id", "project_id",
    postgresql_where=text("deleted_at IS NULL"),  # partial index
)
```

**Use case:** `WHERE deleted_at IS NULL` is in 99% of queries → partial index is much smaller.

---

## 4. Multi-tenancy with RLS

### 4.1 — Three-layer enforcement

1. **Model layer** — `TenantScopedModel` mixin adds `tenant_id` column
2. **Session layer** — `TenantScopedSession` sets `app.tenant_id` GUC per request
3. **DB layer** — Postgres RLS policy enforces isolation

```sql
-- Example RLS policy (auto-generated per migration)
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY stories_tenant_isolation ON stories
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 4.2 — How the session sets the GUC

```python
# backend/app/db/session.py
async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        # Set per-request GUCs for RLS
        await session.execute(text(f"SET LOCAL app.tenant_id = '{principal.tenant_id}'"))
        await session.execute(text(f"SET LOCAL app.actor_id = '{principal.actor_id}'"))
        try:
            yield session
        finally:
            await session.rollback()
```

**`SET LOCAL`** — scoped to the current transaction. Automatically cleared when the transaction commits/rolls back.

### 4.3 — BYPASSRLS (admin-only)

```sql
-- Grant BypassRLS to a specific role
ALTER ROLE forge_admin BYPASSRLS;
```

**Used by:**
- Migration scripts
- Admin LLM Gateway (`/api/v1/admin/llm-gateway/tenants/{tenant_id}`)
- The orchestrator (needs cross-tenant routing)

**Never** in regular API routes.

---

## 5. Soft delete pattern

### 5.1 — Soft delete

```python
async def soft_delete_story(
    db: AsyncSession,
    story_id: UUID,
    actor_id: UUID,
) -> Story:
    story = await db.get(Story, story_id)
    if not story:
        raise HTTPException(404)
    story.deleted_at = datetime.now(timezone.utc)
    story.deleted_by = actor_id
    await db.commit()
    return story
```

### 5.2 — Query (auto-filter deleted)

```python
# TenantScopedSession auto-filters deleted_at IS NULL for tenant-scoped tables
stmt = select(Story).where(Story.id == story_id)
story = (await db.execute(stmt)).scalar_one_or_none()
```

### 5.3 — Hard delete (GDPR only)

```python
async def hard_delete_story_for_gdpr(
    db: AsyncSession,
    story_id: UUID,
) -> None:
    """Hard delete a story for GDPR right-to-be-forgotten.

    This is the ONLY case where hard delete is permitted. All other
    deletes go through soft delete (SoftDeleteMixin).
    """
    await db.execute(delete(Story).where(Story.id == story_id))
    await audit_service.record(
        action="story.gdpr_delete",
        target_type="story",
        target_id=story_id,
        note="Hard delete for GDPR compliance",
    )
```

---

## 6. Soft delete + RLS interplay

For `deleted_at IS NULL` to play nicely with RLS, the RLS policy includes the soft-delete filter:

```sql
CREATE POLICY stories_tenant_isolation ON stories
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND deleted_at IS NULL  -- soft delete
  );
```

This means **soft-deleted rows are invisible** to API queries (the most common case). Recovery requires a Steward override (BYPASSRLS).

---

## 7. Audit + immutability

### 7.1 — `audit_events` table

```python
class AuditEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "audit_events"

    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)

    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )

    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    current_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    __table_args__ = (
        Index("ix_audit_tenant_target", "tenant_id", "target_type", "target_id"),
        Index("ix_audit_tenant_action_time", "tenant_id", "action", "timestamp"),
    )
```

### 7.2 — DB-level immutability

```python
# backend/app/db/models/audit_event.py
@event.listens_for(AuditEvent, "before_update", propagate=True)
def _reject_update(mapper, connection, target):
    raise ImmutableAuditLogError("Audit events are immutable (UPDATE blocked)")

@event.listens_for(AuditEvent, "before_delete", propagate=True)
def _reject_delete(mapper, connection, target):
    raise ImmutableAuditLogError("Audit events are immutable (DELETE blocked)")
```

**Result:** `UPDATE audit_events SET ...` returns error. `DELETE FROM audit_events WHERE ...` returns error.

### 7.3 — SHA-256 hash chain

```python
# Each audit row references the previous row's hash
audit_event.previous_hash = last_event.current_hash if last_event else ZERO_HASH
audit_event.current_hash = sha256(
    audit_event.id + audit_event.payload + audit_event.previous_hash
)
```

**Tamper detection:** If anyone modifies an old audit row (via raw SQL + BypassRLS), the hash chain breaks. Stewards can re-compute the chain to find the break point.

---

## 8. Soft delete + audit pattern

When soft-deleting, the audit event captures the before-state:

```python
@router.delete("/{story_id}", response_model=Story)
@audit(action="story.delete", target_type="story")
async def delete_story(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
):
    story = await db.get(Story, story_id)
    if not story:
        raise HTTPException(404)

    # Capture before-state for audit
    before_state = story.to_dict()

    # Soft delete
    story.deleted_at = datetime.now(timezone.utc)
    story.deleted_by = principal.actor_id
    await db.commit()

    return story  # audit decorator records before_state + after_state
```

**`@audit` decorator** captures `before_state` and `after_state` automatically when the result is a Pydantic model.

---

## 9. Connection pooling

### 9.1 — Async pool config

```python
# backend/app/db/session.py
async_engine = create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,  # catch dead connections
    pool_recycle=3600,  # recycle every hour
    echo=settings.sql_echo,  # dev only
)
```

### 9.2 — Read replicas

For analytics queries (LLM usage dashboard), route to a read replica:

```python
analytics_engine = create_async_engine(
    settings.database_read_replica_url or settings.database_url,
    pool_size=10,
    max_overflow=5,
)
```

---

## 10. Migrations

### 10.1 — Alembic

Forge uses Alembic for migrations:

```bash
# Create a new migration
alembic revision --autogenerate -m "add stories table"

# Apply migrations
alembic upgrade head

# Roll back one step
alembic downgrade -1
```

### 10.2 — Migration directory

```
backend/app/db/migrations/
├── env.py                  # Alembic env
├── script.py.mako          # Migration template
└── versions/
    ├── 0001_initial.py
    ├── 0002_add_stories.py
    ├── ...
    └── 0050_add_seed_runs.py
```

### 10.3 — Migration safety

Every migration must:
- Be **forward-only** (no destructive changes)
- Include a **downgrade** (for rollback testing)
- Be **tested** against a populated database (no `IF NOT EXISTS` hacks)
- Be **idempotent** (safe to re-run)

### 10.4 — Adding a new table

```python
# backend/app/db/migrations/versions/0051_add_new_table.py
def upgrade() -> None:
    op.create_table(
        "new_table",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("tenant_id", GUID(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("project_id", GUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("name", sa.String(200), nullable=False),
    )
    op.create_index("ix_new_table_tenant", "new_table", ["tenant_id"])

    # RLS policy
    op.execute("""
        ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
        CREATE POLICY new_table_tenant_isolation ON new_table
          USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS new_table_tenant_isolation ON new_table;")
    op.drop_index("ix_new_table_tenant", table_name="new_table")
    op.drop_table("new_table")
```

---

## 11. Forbidden patterns

```python
# ❌ Auto-increment integer PK
class Story(Base):
    id: Mapped[int] = mapped_column(primary_key=True)  # UUIDs only

# ❌ Naive datetime
created_at: Mapped[datetime] = mapped_column(DateTime)  # Always DateTime(timezone=True)

# ❌ Missing FK index
class Story(Base):
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))  # Missing index=True

# ❌ Tenant-scoped table without tenant_id
class OrgKnowledge(Base):  # Should extend TenantScopedModel? If yes, missing tenant_id
    name: Mapped[str]

# ❌ TenantScopedModel without RLS policy (migration will fail code review)
class Story(TenantScopedModel, Base):  # No RLS policy in migration = blocker
    __tablename__ = "stories"

# ❌ Hard delete (except GDPR)
await db.execute(delete(Story).where(Story.id == story_id))  # Use soft delete

# ❌ Mutable defaults
tags: Mapped[list[str]] = mapped_column(JSONB, default=[])  # Use default_factory=list

# ❌ JSON (not JSONB)
data: Mapped[dict] = mapped_column(JSON)  # Use JSONB for indexability

# ❌ Audit UPDATE/DELETE (DB-level blocked)
await db.execute(update(AuditEvent).values(...))  # ImmutableAuditLogError
```

---

## 12. Verification checklist

- [ ] Every table has UUID PK (`UUIDPrimaryKeyMixin`)
- [ ] Every table has `created_at` + `updated_at` (`TimestampMixin`)
- [ ] Every tenant-aware table extends `TenantScopedModel`
- [ ] Every tenant-scoped table has an RLS policy in the migration
- [ ] Every mutation table extends `SoftDeleteMixin`
- [ ] Every FK has `index=True`
- [ ] Every column in WHERE/ORDER BY has an index
- [ ] Every datetime is `DateTime(timezone=True)`
- [ ] Every JSON column is `JSONB` (not `JSON`)
- [ ] Every mutable default uses `default_factory=...`
- [ ] Every migration has a `downgrade()`
- [ ] Every `audit_events` row has `previous_hash` + `current_hash`
- [ ] Every mutation captures `before_state` for audit
- [ ] No hard deletes (except GDPR)
- [ ] No direct SQL bypassing the session (use `db.execute()` with ORM models)

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)
- [DB schema](../reference/db-schema.md) — every table + relationship
- [Audit](../features/audit.md) — immutability + hash chain in depth
- [Auth](../features/auth.md) — multi-tenant JWT principal