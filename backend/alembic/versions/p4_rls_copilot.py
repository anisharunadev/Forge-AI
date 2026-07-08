"""Phase 4 N — Row-level security on copilot_conversations and copilot_messages.

Adds ``user_id`` to ``copilot_messages`` (denormalized from the parent
conversation so the USING clause can filter without a join) and forces
RLS on both tables. The backend session sets the ``app.tenant_id`` and
``app.user_id`` GUCs per request — see ``app.db.session`` for the
plumbing; the policy reads them at row-scan time.

Skipped: a separate row-level policy for ``copilot_messages`` is the
same predicate joined through the parent conversation. We
denormalize here so the policy is symmetric across both tables and
so future indexes can target ``(tenant_id, user_id, created_at)`` on
messages without a join.
"""

from __future__ import annotations

from alembic import op


# Revision identifiers, used by Alembic.
revision = "p4_rls_copilot"
down_revision = "step_92_m10_copilot_typing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add ``user_id`` to copilot_messages. Backfill from the parent
    # conversation so existing rows satisfy the new RLS predicate.
    op.execute(
        "ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS user_id UUID"
    )
    op.execute(
        """
        UPDATE copilot_messages m
           SET user_id = c.user_id
          FROM copilot_conversations c
         WHERE m.conversation_id = c.id
           AND m.user_id IS NULL
        """
    )
    op.execute(
        "ALTER TABLE copilot_messages ALTER COLUMN user_id SET NOT NULL"
    )
    op.create_index(
        "ix_copilot_messages_user_id",
        "copilot_messages",
        ["user_id"],
    )
    op.create_index(
        "ix_copilot_messages_tenant_user",
        "copilot_messages",
        ["tenant_id", "user_id"],
    )

    # 2. Force RLS on copilot_conversations.
    op.execute("ALTER TABLE copilot_conversations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE copilot_conversations FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY copilot_conversations_user_isolation
            ON copilot_conversations
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
                AND user_id::text = current_setting('app.user_id', true)
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
                AND user_id::text = current_setting('app.user_id', true)
            );
        """
    )

    # 3. Force RLS on copilot_messages.
    op.execute("ALTER TABLE copilot_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE copilot_messages FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY copilot_messages_user_isolation
            ON copilot_messages
            USING (
                tenant_id::text = current_setting('app.tenant_id', true)
                AND user_id::text = current_setting('app.user_id', true)
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.tenant_id', true)
                AND user_id::text = current_setting('app.user_id', true)
            );
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS copilot_messages_user_isolation ON copilot_messages")
    op.execute("ALTER TABLE copilot_messages NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE copilot_messages DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_copilot_messages_tenant_user", table_name="copilot_messages")
    op.drop_index("ix_copilot_messages_user_id", table_name="copilot_messages")
    op.execute("ALTER TABLE copilot_messages DROP COLUMN IF EXISTS user_id")

    op.execute("DROP POLICY IF EXISTS copilot_conversations_user_isolation ON copilot_conversations")
    op.execute("ALTER TABLE copilot_conversations NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE copilot_conversations DISABLE ROW LEVEL SECURITY")
