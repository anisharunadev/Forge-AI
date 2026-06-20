"""
Synthetic service accounts — ADR-0010 §5 + FORA-264 AC #4 / #5.

The "no impersonation" rule (ADR-0010 §5 + FORA-264 AC #5)
means every cross-platform comment is posted by a synthetic
service account owned by the tenant, never by a Paperclip
agent's personal account.  This module provisions those
accounts on first-connect and records the
`(tenant_slug, agent_id, platform)` → `service_account_id`
mapping.

Naming convention (FORA-264 AC #4):

    paperclip-{tenant_slug}                            (system)
    paperclip-{tenant_slug}-{agent_id_short}           (per-agent persona)
    paperclip-board-{tenant_slug}                       (Board / local-board)

Where `agent_id_short` is the first 8 hex chars of the agent
uuid (the canonical id the tenant admin sees in the install
URL).  The full mapping is in `author_mapping.py`; this module
is the *naming + provisioning* layer.

The lifecycle:

  1. `provision_tenant_accounts(tenant_slug, platforms)`
     creates the system + board accounts on the listed platforms
     and records the mapping rows.  Idempotent — calling twice
     with the same args is a no-op.
  2. `provision_agent_account(tenant_slug, agent_id, platforms, ...)`
     creates the per-agent persona accounts and records the
     mapping rows.  Idempotent.
  3. `service_account_for(tenant_slug, agent_id, platform)`
     returns the canonical service-account id the adapter must
     use when posting.

Audit row per provision: `sync.event.comment.attribution_written`
with `metadata.kind = "service_account_provisioned"`.  The
FORA-36 forwarder hashes the row so a tenant admin can prove
no human user posted on the customer's Jira/GitHub/ClickUp.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from .author_mapping import (
    AuthorMappingTable,
    AuthorMappingRow,
)


# ---------------------------------------------------------------------------
# Naming convention
# ---------------------------------------------------------------------------

_TENANT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_AGENT_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

ACCOUNT_KINDS = ("system", "board", "agent")


def _short_agent_id(agent_id: str) -> str:
    """First 8 hex chars of the agent uuid — the canonical
    short form for the service-account name suffix."""
    if not _AGENT_ID_RE.match(agent_id or ""):
        raise ValueError(
            f"agent_id must be a uuid; got {agent_id!r}"
        )
    return agent_id.split("-", 1)[0].lower()


def _validate_tenant_slug(slug: str) -> None:
    if not slug or not _TENANT_SLUG_RE.match(slug):
        raise ValueError(
            f"tenant_slug must match {_TENANT_SLUG_RE.pattern}; "
            f"got {slug!r}"
        )


# Account-id generators ---------------------------------------------------
# Stable, deterministic, derived from the canonical inputs.  Two
# runs with the same inputs always produce the same id — this
# is what makes provisioning idempotent.

def _system_account_id(tenant_slug: str, platform: str) -> str:
    return f"paperclip-{tenant_slug}@{platform}"


def _board_account_id(tenant_slug: str, platform: str) -> str:
    return f"paperclip-board-{tenant_slug}@{platform}"


def _agent_account_id(
    tenant_slug: str, agent_id: str, platform: str
) -> str:
    return f"paperclip-{tenant_slug}-{_short_agent_id(agent_id)}@{platform}"


# ---------------------------------------------------------------------------
# Pure functions — what an account *should* be called
# ---------------------------------------------------------------------------

def expected_system_account_id(tenant_slug: str, platform: str) -> str:
    """The canonical system service-account id for (tenant, platform).

    Pure: same inputs always produce the same id.  Callers use
    this when comparing the canonical id to the live id on the
    remote platform (idempotency check)."""
    _validate_tenant_slug(tenant_slug)
    if platform not in ("jira", "github", "clickup"):
        raise ValueError(f"unknown platform: {platform!r}")
    return _system_account_id(tenant_slug, platform)


def expected_board_account_id(tenant_slug: str, platform: str) -> str:
    _validate_tenant_slug(tenant_slug)
    if platform not in ("jira", "github", "clickup"):
        raise ValueError(f"unknown platform: {platform!r}")
    return _board_account_id(tenant_slug, platform)


def expected_agent_account_id(
    tenant_slug: str, agent_id: str, platform: str
) -> str:
    _validate_tenant_slug(tenant_slug)
    if platform not in ("jira", "github", "clickup"):
        raise ValueError(f"unknown platform: {platform!r}")
    return _agent_account_id(tenant_slug, agent_id, platform)


# ---------------------------------------------------------------------------
# Provisioning result
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProvisionedAccount:
    """One row returned by the provisioning helpers.  The caller
    passes this to the platform adapter so it can verify the
    account exists on the remote (or create it if it does not)."""
    account_id: str
    account_kind: str            # "system" / "board" / "agent"
    tenant_slug: str
    platform: str
    display_name: str
    mapping_row: AuthorMappingRow


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------

def _row_already_provisioned(
    table: AuthorMappingTable,
    *,
    kind: str,
    paperclip_id: str,
    platform: str,
) -> bool:
    return table.lookup(
        kind=kind, paperclip_id=paperclip_id, platform=platform
    ) is not None


def provision_tenant_accounts(
    *,
    table: AuthorMappingTable,
    tenant_slug: str,
    platforms: Iterable[str],
    display_name: str = "Paperclip",
    board_display_name: str = "Paperclip Board",
    hlc: str = "0000000000000.000-0001",
) -> List[ProvisionedAccount]:
    """Provision the system + board accounts for `tenant_slug`
    on each platform.  Idempotent: existing rows are left alone;
    new rows are appended with `reason = "first_connect"`.

    The `kind` on the author_mapping row is `system` for the
    system account (a system account is mapped to the
    `paperclip-system-{tenant}` Paperclip id) and `board` for
    the Board account (mapped to the `local-board` Paperclip id).
    """
    _validate_tenant_slug(tenant_slug)
    out: List[ProvisionedAccount] = []
    for platform in platforms:
        if platform not in ("jira", "github", "clickup"):
            raise ValueError(f"unknown platform: {platform!r}")
        # System account
        system_paperclip_id = f"paperclip-system-{tenant_slug}"
        if not _row_already_provisioned(
            table,
            kind="system",
            paperclip_id=system_paperclip_id,
            platform=platform,
        ):
            row = table.append(
                kind="system",
                paperclip_id=system_paperclip_id,
                platform=platform,
                remote_id=_system_account_id(tenant_slug, platform),
                remote_display=f"{display_name} ({tenant_slug})",
                created_hlc=hlc,
                reason="first_connect",
                audit_event="sync.event.comment.attribution_written",
            )
        else:
            row = table.lookup(
                kind="system",
                paperclip_id=system_paperclip_id,
                platform=platform,
            )
        out.append(
            ProvisionedAccount(
                account_id=_system_account_id(tenant_slug, platform),
                account_kind="system",
                tenant_slug=tenant_slug,
                platform=platform,
                display_name=f"{display_name} ({tenant_slug})",
                mapping_row=row,
            )
        )
        # Board account
        board_paperclip_id = f"local-board"
        if not _row_already_provisioned(
            table,
            kind="board",
            paperclip_id=board_paperclip_id,
            platform=platform,
        ):
            row = table.append(
                kind="board",
                paperclip_id=board_paperclip_id,
                platform=platform,
                remote_id=_board_account_id(tenant_slug, platform),
                remote_display=f"{board_display_name} ({tenant_slug})",
                created_hlc=hlc,
                reason="first_connect",
                audit_event="sync.event.comment.attribution_written",
            )
        else:
            row = table.lookup(
                kind="board",
                paperclip_id=board_paperclip_id,
                platform=platform,
            )
        out.append(
            ProvisionedAccount(
                account_id=_board_account_id(tenant_slug, platform),
                account_kind="board",
                tenant_slug=tenant_slug,
                platform=platform,
                display_name=f"{board_display_name} ({tenant_slug})",
                mapping_row=row,
            )
        )
    return out


def provision_agent_account(
    *,
    table: AuthorMappingTable,
    tenant_slug: str,
    agent_id: str,
    platform: str,
    display_name: str,
    hlc: str,
) -> ProvisionedAccount:
    """Provision the per-agent persona account for `(tenant_slug,
    agent_id, platform)`.  Idempotent: existing rows are left
    alone; new rows are appended with `reason = "first_connect"`.

    The `display_name` is the tenant-visible name the adapter
    uses when configuring the service account on the remote
    (e.g. "DocAgent (FORA-118)").  Per ADR-0010 §5 the display
    name carries the Paperclip-side id so a customer admin can
    trace a remote comment back to its Paperclip actor."""
    _validate_tenant_slug(tenant_slug)
    if platform not in ("jira", "github", "clickup"):
        raise ValueError(f"unknown platform: {platform!r}")
    if not _AGENT_ID_RE.match(agent_id or ""):
        raise ValueError(f"agent_id must be a uuid; got {agent_id!r}")
    if not _row_already_provisioned(
        table,
        kind="agent",
        paperclip_id=agent_id,
        platform=platform,
    ):
        row = table.append(
            kind="agent",
            paperclip_id=agent_id,
            platform=platform,
            remote_id=_agent_account_id(tenant_slug, agent_id, platform),
            remote_display=display_name,
            created_hlc=hlc,
            reason="first_connect",
            audit_event="sync.event.comment.attribution_written",
        )
    else:
        row = table.lookup(
            kind="agent",
            paperclip_id=agent_id,
            platform=platform,
        )
    return ProvisionedAccount(
        account_id=_agent_account_id(tenant_slug, agent_id, platform),
        account_kind="agent",
        tenant_slug=tenant_slug,
        platform=platform,
        display_name=display_name,
        mapping_row=row,
    )


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def service_account_for(
    table: AuthorMappingTable,
    *,
    tenant_slug: str,
    agent_id: Optional[str],
    platform: str,
    board: bool = False,
) -> Optional[str]:
    """Return the service-account id the adapter must use when
    posting a cross-platform comment.  Returns None if the
    account has not been provisioned yet — the caller is then
    expected to provision it (or refuse to post, per tenant
    policy).

    `board = True` returns the Board / `local-board` account;
    `agent_id` is ignored in that case.
    """
    _validate_tenant_slug(tenant_slug)
    if platform not in ("jira", "github", "clickup"):
        raise ValueError(f"unknown platform: {platform!r}")
    if board:
        paperclip_id = "local-board"
        kind = "board"
    elif agent_id is None:
        # System account (e.g. status-mirror events)
        paperclip_id = f"paperclip-system-{tenant_slug}"
        kind = "system"
    else:
        paperclip_id = agent_id
        kind = "agent"
    row = table.lookup(
        kind=kind, paperclip_id=paperclip_id, platform=platform
    )
    return row.remote_id if row else None
