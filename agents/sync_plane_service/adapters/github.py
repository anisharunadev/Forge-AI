"""
GitHub Issues platform adapter (FORA-201 / 11.2b).

Implements the `PlatformAdapter` Protocol declared in
`agents.sync_plane_service.ports` and registers under
`PORT_PLATFORM_GITHUB = "platform.github"`.

The adapter is the **only writer** to GitHub Issues for
the FORA Sync Plane. It encapsulates:

  * Auth — per-tenant GitHub App installation tokens
    (the `GitHubAuthProvider` Protocol; the day-one
    `EnvBackedGitHubAuthProvider` reads from env, the
    customer-cloud-broker (FORA-126) will replace it).
  * HTTP — the `GitHubTransport` Protocol; the day-one
    `UrllibGitHubTransport` is in `_transport.py`.
  * State mapping — `StatusMapping` (the only place
    GitHub-shape state knowledge lives; the Jira
    adapter copies the table verbatim with a
    different platform key).
  * Comment mapping — `CanonicalComment` (FORA-253)
    ↔ GitHub Issue comment with author attribution.
  * 30s comment debounce — an in-adapter optimisation
    keyed by `(tenant, entity_id, comment_id)` that
    coalesces repeat posts inside the debounce
    window. The BurstControl port handles the
    5000 req/h ceiling; the debounce is a separate,
    cheaper, in-adapter optimisation that the
    Jira sibling will mirror.
  * Idempotency — `remote_refs["github"]` stores the
    issue number; re-runs of the same event find
    the issue and `PATCH` it instead of `POST`-ing
    a duplicate.
  * Divergence signal — a non-2xx response with a
    `_foradb` field set is converted into a
    `sync.event.divergence_detected` audit event
    via the injected `AuditForwarder` (None in
    day-one smoke; the service wires it in at
    start-up).

The adapter is **dependency-free** and **pure
Python** so the smoke test runs in <1s without
Postgres, Redis, or a real GitHub App. The test
transport (`_test_transport.py`) replays a
recorded interaction; the smoke asserts every
AC (FORA-201) and writes an evidence JSON.

Day-one AC mapping (see the `plan` document on
FORA-201 for the full design):

    AC1 create   — `apply_mirror(entity)` on a new
                   entity creates a GitHub Issue and
                   stores the returned `number` in
                   `remote_refs["github"]`.
    AC2 comment  — `apply_mirror(entity, comment=cc)`
                   posts an Issue comment. Re-calls
                   on the same `(entity, comment)`
                   return the original `id` from
                   `remote_refs["github"]["comment:<id>"]`
                   (idempotent).
    AC3 status   — `apply_mirror(entity)` after a
                   status change PATCHes the Issue
                   with the mapped `state` and
                   `state_reason`.
    AC4 rate     — The 5000 req/h ceiling is the
                   BurstControl port's job (wired
                   in service.py). The 30s debounce
                   lives in-adapter (this module) as
                   a per-`(tenant, entity, comment)`
                   `last_post_at` map.
    AC5 diverge  — The adapter emits
                   `sync.event.divergence_detected`
                   when the response state differs
                   from the requested state.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Protocol, Tuple, runtime_checkable

from ..ports import (
    AdapterHealth,
    AuditForwarder,
    MirrorResult,
    PlatformAdapter,
)
from ..schema import (
    CanonicalComment,
    EntityKind,
    SyncEntity,
)
from ._transport import (
    GitHubResponse,
    GitHubTransport,
)


_log = logging.getLogger("fora.sync_plane_service.adapters.github")


# Day-one debounce window for comment posts (per the FORA-201
# AC and the §10 workspace tech-stack note). A repeat post
# for the same `(tenant, entity, comment)` inside this window
# is coalesced into the original post (the response is the
# cached `id`). The BurstControl port enforces the 5000 req/h
# ceiling separately; the debounce is an in-adapter
# optimisation that pre-empts the burst check for the
# common case of a "draft → save → save → save" comment
# edit pattern.
COMMENT_DEBOUNCE_SECONDS = 30


# -- Status mapping -----------------------------------------------------------


# The Paperclip status strings the service uses. Centralised
# here so the Jira adapter can import the same constants and
# only the platform key changes.
PAPERCLIP_STATUS_TODO = "todo"
PAPERCLIP_STATUS_IN_PROGRESS = "in_progress"
PAPERCLIP_STATUS_IN_REVIEW = "in_review"
PAPERCLIP_STATUS_BLOCKED = "blocked"
PAPERCLIP_STATUS_BACKLOG = "backlog"
PAPERCLIP_STATUS_DONE = "done"
PAPERCLIP_STATUS_CANCELLED = "cancelled"


class StatusMappingError(KeyError):
    """Raised when a Paperclip status or GitHub state has
    no mapping in the configured `StatusMapping`.

    Inherits from `KeyError` for backward-compat with any
    existing callers that catch `KeyError` from a dict
    lookup, but callers that want to distinguish "schema
    gap" from "real bug" should catch `StatusMappingError`
    directly.

    Verdict invariant (FORA-201 AC#3, FORA-435 acceptance
    bar): an unknown Paperclip status MUST raise
    `StatusMappingError`. There is no silent default — a
    mapping that silently maps `unknown_status` to `open`
    would lose work, which is the exact failure mode the
    §2 mapping table is designed to prevent."""

    def __init__(
        self,
        message: str,
        *,
        paperclip_status: Optional[str] = None,
        github_state: Optional[str] = None,
        github_state_reason: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.paperclip_status = paperclip_status
        self.github_state = github_state
        self.github_state_reason = github_state_reason


@dataclass(frozen=True)
class StatusMapping:
    """A pure mapping table between a Paperclip status and
    the GitHub Issue `state` + `state_reason` pair. The
    inverse (`from_github`) lives on the same dataclass
    so the file a reviewer audits is one file.

    The dataclass is frozen so a reviewer can hash the
    table and check it into a regression test; future
    status additions are a single line in the
    `forward` / `inverse` dicts.

    `tenant_status_overrides` is the **read-only seam**
    for per-customer status mapping (FORA-201 AC#3
    "per-tenant override hook"). Keyed by
    `(paperclip_status, tenant_id)`; the value is the
    `(state, state_reason)` tuple the adapter should
    apply for that tenant instead of the default. Day-one
    v0.1 ships the field and the public function consults
    it; production wiring (per-tenant config from the
    tenant settings store, surfaced via the
    customer-cloud-broker FORA-126) is a Phase 2
    follow-up. Adding a customer override is a single
    line in the dict — no mapping logic changes."""
    forward: Dict[str, "GitHubState"] = field(default_factory=dict)
    inverse: Dict["GitHubState", str] = field(default_factory=dict)
    tenant_status_overrides: Dict[Tuple[str, str], Tuple[str, str]] = field(
        default_factory=dict,
    )

    def to_github(self, paperclip_status: str) -> "GitHubState":
        try:
            return self.forward[paperclip_status]
        except KeyError as exc:
            raise StatusMappingError(
                f"no Paperclip->GitHub mapping for status "
                f"{paperclip_status!r}; add it to StatusMapping.forward",
                paperclip_status=paperclip_status,
            ) from exc

    def to_github_for_tenant(
        self,
        tenant_id: str,
        paperclip_status: str,
    ) -> "GitHubState":
        """Look up the GitHub state for a `(tenant, status)`
        pair, consulting `tenant_status_overrides` first.
        Falls back to the default forward mapping. The
        public function callers use this so the adapter
        never accidentally drops a customer override."""
        override = self.tenant_status_overrides.get(
            (paperclip_status, tenant_id)
        )
        if override is not None:
            state, state_reason = override
            return GitHubState(state=state, state_reason=state_reason)
        return self.to_github(paperclip_status)

    def to_paperclip(self, gh_state: "GitHubState") -> str:
        try:
            return self.inverse[gh_state]
        except KeyError as exc:
            raise StatusMappingError(
                f"no GitHub->Paperclip mapping for state "
                f"({gh_state.state!r}, {gh_state.state_reason!r}); "
                f"add it to StatusMapping.inverse",
                github_state=gh_state.state,
                github_state_reason=gh_state.state_reason,
            ) from exc


@dataclass(frozen=True)
class GitHubState:
    """A GitHub Issue's `state` + `state_reason` pair.
    `state_reason` is a GitHub-only field; we mirror it
    onto Paperclip's status (e.g. `not_planned` →
    `cancelled`, `completed` → `done`)."""
    state: str          # "open" | "closed"
    state_reason: str   # "" | "completed" | "not_planned" | "reopened"


# The day-one mapping. The five "active" Paperclip statuses
# all map to `open`; `done` → `closed + completed`; `cancelled`
# → `closed + not_planned`. The reverse direction is
# intentionally less granular: GitHub `open` is the most
# common case, and we treat it as `in_progress` (a fresh
# `todo` is a Stage-1 sub-agent's first action anyway).
# `tenant_status_overrides` defaults to an empty dict; the
# Phase 2 wiring will populate it from the tenant config
# store surfaced through the customer-cloud-broker (FORA-126).
_DAY_ONE_MAPPING = StatusMapping(
    forward={
        PAPERCLIP_STATUS_TODO:        GitHubState("open", ""),
        PAPERCLIP_STATUS_IN_PROGRESS: GitHubState("open", ""),
        PAPERCLIP_STATUS_IN_REVIEW:   GitHubState("open", ""),
        PAPERCLIP_STATUS_BLOCKED:     GitHubState("open", ""),
        PAPERCLIP_STATUS_BACKLOG:     GitHubState("open", ""),
        PAPERCLIP_STATUS_DONE:        GitHubState("closed", "completed"),
        PAPERCLIP_STATUS_CANCELLED:   GitHubState("closed", "not_planned"),
    },
    inverse={
        GitHubState("open", ""):                  PAPERCLIP_STATUS_IN_PROGRESS,
        GitHubState("closed", "completed"):       PAPERCLIP_STATUS_DONE,
        GitHubState("closed", "not_planned"):     PAPERCLIP_STATUS_CANCELLED,
        # A `closed` with no reason is treated as completed
        # (GitHub closes issues for merges / commit pushes
        # without setting a `state_reason`).
        GitHubState("closed", ""):                PAPERCLIP_STATUS_DONE,
        GitHubState("open", "reopened"):          PAPERCLIP_STATUS_IN_PROGRESS,
    },
)


def map_status_paperclip_to_github(
    status: str,
    *,
    tenant_id: Optional[str] = None,
    mapping: Optional[StatusMapping] = None,
) -> GitHubState:
    """Public function. Used by the smoke test and by any
    future caller (e.g. the divergence workbench preview)
    that needs the mapping without instantiating an
    adapter.

    Pass `tenant_id` to consult the per-tenant override
    seam (`StatusMapping.tenant_status_overrides`); the
    override wins over the default forward mapping.
    Without `tenant_id`, the default day-one mapping
    applies.

    Pass `mapping` to consult a non-default `StatusMapping`
    (the read-only override seam in test, and the Phase 2
    per-tenant wiring from the customer-cloud-broker
    FORA-126). Defaults to `_DAY_ONE_MAPPING`. The
    function stays pure — it does not mutate module
    state and does not hold any in-memory cache; the
    same `(status, tenant_id, mapping)` triple always
    returns the same `GitHubState`."""
    target = mapping if mapping is not None else _DAY_ONE_MAPPING
    if tenant_id is not None:
        return target.to_github_for_tenant(tenant_id, status)
    return target.to_github(status)


def map_status_github_to_paperclip(
    state: str,
    state_reason: str = "",
    *,
    mapping: Optional[StatusMapping] = None,
) -> str:
    """Public function. Inverse of the above. Per-tenant
    overrides on the inverse direction are out of scope
    for v0.1; the inverse mapping is symmetric across
    tenants by design (the GitHub-side field is the
    source of truth). The `mapping` kwarg mirrors the
    forward function so callers can route both
    directions through the same `StatusMapping` instance
    (test wiring + Phase 2 tenant overrides)."""
    target = mapping if mapping is not None else _DAY_ONE_MAPPING
    return target.to_paperclip(GitHubState(state, state_reason or ""))


# -- Auth seam ---------------------------------------------------------------


@runtime_checkable
class GitHubAuthProvider(Protocol):
    """The auth seam. The day-one `EnvBackedGitHubAuthProvider`
    reads `FORA_TENANT_<SLUG>_GITHUB_INSTALLATION_TOKEN`
    and `..._INSTALLATION_ID`. The customer-cloud-broker
    (FORA-126) will replace it with a canary-signed OIDC
    path. The seam is the Protocol; the day-one impl is
    the swappable surface."""

    def installation_token(self, tenant_id: str) -> str:
        """Return a valid bearer token for the tenant's
        GitHub App installation. The implementation is
        responsible for refresh; the adapter only sees
        a valid token (or empty string for an
        unauthenticated dry-run)."""

    def installation_id(self, tenant_id: str) -> int:
        """Return the GitHub App installation id for the
        tenant. Used in `Authorization` for the App
        JWT swap (the App authenticates as itself and
        exchanges a short-lived token for the
        installation)."""


class EnvBackedGitHubAuthProvider:
    """Day-one auth: read the token and installation id
    from environment variables named after the tenant
    slug. No file I/O, no Vault, no broker round-trip.

    Convention:

        FORA_TENANT_<SLUG>_GITHUB_INSTALLATION_TOKEN
        FORA_TENANT_<SLUG>_GITHUB_INSTALLATION_ID

    where `<SLUG>` is the upper-cased tenant slug with
    hyphens replaced by underscores. Example: a tenant
    `acme-co` reads `FORA_TENANT_ACME_CO_GITHUB_*`.

    The day-one is intentionally trivial: a customer
    who already has a GitHub App installation copies
    the token into their environment, and the
    Sync Plane works. The customer-cloud-broker
    (FORA-126) replace this with OIDC + canary
    signature; the seam is `GitHubAuthProvider`."""

    __slots__ = ("_cache",)

    def __init__(self) -> None:
        # Cache (tenant_id -> (token, installation_id)) so a
        # burst doesn't re-read env. The env is treated as
        # immutable per process; restart for a token rotation.
        self._cache: Dict[str, "tuple[str, int]"] = {}

    def _slug_key(self, tenant_id: str) -> str:
        # `acme-co` -> `ACME_CO`
        return tenant_id.upper().replace("-", "_")

    def _lookup(self, tenant_id: str) -> "tuple[str, int]":
        if tenant_id in self._cache:
            return self._cache[tenant_id]
        slug = self._slug_key(tenant_id)
        token = os.environ.get(f"FORA_TENANT_{slug}_GITHUB_INSTALLATION_TOKEN", "")
        inst_raw = os.environ.get(f"FORA_TENANT_{slug}_GITHUB_INSTALLATION_ID", "0")
        try:
            installation_id = int(inst_raw)
        except ValueError:
            installation_id = 0
        self._cache[tenant_id] = (token, installation_id)
        return self._cache[tenant_id]

    def installation_token(self, tenant_id: str) -> str:
        return self._lookup(tenant_id)[0]

    def installation_id(self, tenant_id: str) -> int:
        return self._lookup(tenant_id)[1]


# -- Audit forwarder (optional, day-one None) -------------------------------


@runtime_checkable
class GitHubAuditHook(Protocol):
    """Optional seam. The service wires a real
    `AuditForwarder` in production (FORA-252 wires the
    default `InMemoryAuditForwarder` to the FORA-36
    audit store). The day-one smoke uses `None`; the
    adapter short-circuits the call.

    The hook exists as a separate Protocol (not the
    `AuditForwarder` from `ports.py`) because the
    adapter only needs three of the seven `forward`
    parameters; pulling the full audit shape into
    the adapter would couple the GitHub write path
    to the audit module's full vocabulary.

    FORA-433 (FORA-201.2) adds two comment-audit
    methods (`target_comment_ok`, `source_comment_ok`)
    on top of the day-one `divergence_detected`.

    FORA-431 (FORA-201.1) adds two issue-audit methods
    (`target_issue_ok`, `source_issue_ok`) for the
    bidirectional issue mirror: `target_issue_ok`
    fires after a successful outbound create / update;
    `source_issue_ok` fires after an inbound webhook
    payload has been normalized into a canonical
    `ReceivedEvent`. Payload carries `{tenant,
    paperclip_id, github_number}` per the FORA-431
    AC #1 close-gate evidence."""

    def divergence_detected(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        requested_state: GitHubState,
        observed_state: GitHubState,
        remote_response_status: int,
    ) -> None:
        """Called when the GitHub response disagrees with
        the requested state. The default impl writes
        a `sync.event.divergence_detected` audit row;
        the smoke test uses a recording fake."""

    def target_comment_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        comment_id: str,
        remote_comment_id: Any,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """FORA-433: outbound comment mirror succeeded
        (Paperclip comment -> GitHub Issue comment).
        Emits a `sync.target.comment.ok` audit row in
        production. `comment_id` is the canonical
        Paperclip comment id; `remote_comment_id` is
        the GitHub-issued numeric id. `metadata`
        carries the rate-limit snapshot."""

    def source_comment_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        comment_id: str,
        source_login: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """FORA-433: inbound webhook normalized
        successfully (GitHub `issue_comment.created` ->
        canonical `CanonicalComment`). Emits a
        `sync.source.comment.ok` audit row in
        production. `source_login` is the raw GitHub
        `user.login` before FORA-253 author mapping."""

    def target_issue_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        github_number: str,
        operation: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """FORA-431 (FORA-201.1): outbound issue mirror
        succeeded (Paperclip issue -> GitHub Issue).
        Emits a `sync.target.issue.ok` audit row in
        production with `{tenant, paperclip_id,
        github_number, operation}` payload.
        `operation` is `create` or `update`."""

    def source_issue_ok(
        self,
        tenant_id: str,
        entity_id: str,
        *,
        github_number: str,
        action: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """FORA-431 (FORA-201.1): inbound webhook
        normalized successfully (GitHub `issues.opened`
        -> canonical `ReceivedEvent`). Emits a
        `sync.source.issue.ok` audit row in production
        with `{tenant, paperclip_id, github_number,
        action}` payload. `action` is the raw GitHub
        webhook action (`opened` / `reopened` /
        `edited`)."""


class NullGitHubAuditHook:
    """Day-one default. Discards the event. Production
    wiring replaces with the real forwarder."""
    def divergence_detected(self, *args: Any, **kwargs: Any) -> None:
        return None
    def target_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None
    def source_comment_ok(self, *args: Any, **kwargs: Any) -> None:
        return None
    def target_issue_ok(self, *args: Any, **kwargs: Any) -> None:
        return None
    def source_issue_ok(self, *args: Any, **kwargs: Any) -> None:
        return None


# -- Author mapping (FORA-433 / FORA-201.2 / FORA-253) -----------------------


class AuthorMappingError(Exception):
    """Raised by `GitHubAuthorMapper.map_github_login` when
    the inbound GitHub `user.login` cannot be translated to
    a Paperclip author identity.

    Per FORA-201.2 AC #2 the verdict invariant is
    `unknown author -> AuthorMappingError, never post as
    Paperclip user`. The adapter catches this on the
    inbound `normalize_issue_comment_webhook` path and
    surfaces a `MirrorResult(ok=False, error=...)` without
    a transport call; the audit log gets no `source.comment.ok`
    row (the FORA-36 `tool_call` failure path records the
    exception via the service's standard failure sink).
    """
    def __init__(self, source_login: str, reason: str = "") -> None:
        self.source_login = source_login
        self.reason = reason or f"unknown github author {source_login!r}"
        super().__init__(self.reason)


@dataclass(frozen=True)
class MappedPaperclipAuthor:
    """The mapped Paperclip author identity for an inbound
    GitHub comment author. Mirrors the three author fields
    on `CanonicalComment` so the inbound path can construct
    the envelope directly. `author_kind` is one of
    `agent` / `user` / `board` / `system`; for GitHub bot
    accounts the mapping is always `agent` (the
    FORA-253 service-account convention)."""
    author_kind: str
    author_id: str
    author_display_name: str


@runtime_checkable
class GitHubAuthorMapper(Protocol):
    """The author-mapping seam for inbound comment webhooks
    (FORA-201.2 AC #2). The day-one impl
    (`EnvBackedGitHubAuthorMapper`) reads a JSON map from
    an env var; Phase 2 replaces it with the broker-fed
    per-tenant table (FORA-126) without changing this
    Protocol.

    `map_github_login` raises `AuthorMappingError` on
    unknown login; `known_logins` is an introspection aid
    for the smoke test and the operator console."""

    def map_github_login(self, tenant_id: str, login: str) -> MappedPaperclipAuthor:
        """Translate a GitHub `user.login` to a Paperclip
        author identity. Raises `AuthorMappingError` if
        `login` is not in the per-tenant mapping table."""

    def known_logins(self, tenant_id: str) -> list:
        """Return the logins the mapper currently knows
        about for the tenant. Empty list means 'no
        mappings configured' (every inbound comment will
        raise `AuthorMappingError`)."""


class EnvBackedGitHubAuthorMapper:
    """Day-one author mapper. Reads the per-tenant mapping
    table from an env var of the form

        FORA_TENANT_<SLUG>_GITHUB_AUTHOR_MAP

    whose value is a JSON object mapping `login` to a
    3-tuple object with `kind`, `id`, and `display_name`
    keys. Example:

        FORA_TENANT_ACME_CO_GITHUB_AUTHOR_MAP='{
          "dependabot[bot]":   {"kind":"agent","id":"service-account:dependabot","display_name":"Dependabot"},
          "github-actions[bot]":{"kind":"agent","id":"service-account:ci","display_name":"GitHub Actions"}
        }'

    A tenant with no env var returns an empty mapping;
    every inbound comment raises `AuthorMappingError`
    (the safe default — the FORA-201.2 AC says
    "unknown author -> AuthorMappingError, never post
    as Paperclip user")."""

    __slots__ = ("_cache",)

    def __init__(self) -> None:
        # tenant_id -> Dict[login, MappedPaperclipAuthor]
        self._cache: Dict[str, Dict[str, MappedPaperclipAuthor]] = {}

    def _slug_key(self, tenant_id: str) -> str:
        return tenant_id.upper().replace("-", "_")

    def _load(self, tenant_id: str) -> Dict[str, MappedPaperclipAuthor]:
        if tenant_id in self._cache:
            return self._cache[tenant_id]
        import json as _json
        slug = self._slug_key(tenant_id)
        raw = os.environ.get(f"FORA_TENANT_{slug}_GITHUB_AUTHOR_MAP", "")
        mapping: Dict[str, MappedPaperclipAuthor] = {}
        if raw:
            try:
                parsed = _json.loads(raw)
                if isinstance(parsed, dict):
                    for login, entry in parsed.items():
                        if not isinstance(entry, dict):
                            continue
                        kind = str(entry.get("kind", "agent"))
                        aid = str(entry.get("id", ""))
                        name = str(entry.get("display_name", login))
                        if aid:
                            mapping[str(login)] = MappedPaperclipAuthor(
                                author_kind=kind,
                                author_id=aid,
                                author_display_name=name,
                            )
            except _json.JSONDecodeError:
                # A malformed env var is a config bug; the
                # adapter treats it as "no mappings known".
                # The smoke test does not exercise this path.
                mapping = {}
        self._cache[tenant_id] = mapping
        return mapping

    def map_github_login(
        self, tenant_id: str, login: str,
    ) -> MappedPaperclipAuthor:
        mapping = self._load(tenant_id)
        try:
            return mapping[login]
        except KeyError as exc:
            raise AuthorMappingError(
                source_login=login,
                reason=(
                    f"github login {login!r} is not in the "
                    f"tenant {tenant_id!r} author map; refusing "
                    f"to post as a Paperclip user"
                ),
            ) from exc

    def known_logins(self, tenant_id: str) -> list:
        return sorted(self._load(tenant_id).keys())


# -- The adapter -------------------------------------------------------------


@dataclass
class _DebounceIndex:
    """The 30s comment-debounce map. Keyed by
    `(tenant_id, entity_id, comment_id)` so a comment
    edit on issue A doesn't suppress a comment post
    on issue B. Stores `(timestamp, remote_id)` per
    key; subsequent posts within `COMMENT_DEBOUNCE_SECONDS`
    return the cached `remote_id` (the GitHub-issued
    numeric id of the first post) so the caller's
    `MirrorResult` is stable across the debounce
    window. FORA-433 added the `remote_id` slot —
    the day-one impl stored only the timestamp and
    the caller had no way to know what id the
    debounced post would have had. FORA-437 (FORA-201.4
    AC#4) promoted the key from the colon-joined
    string the day-one impl used to the typed
    3-tuple so the spec `last_post_at:
    dict[tuple[str, str, str], float]` matches the
    type at the call site, and added an injectable
    `clock` so the smoke test can advance the
    debounce window deterministically (no
    `time.sleep(31)`)."""
    _last_post_at: Dict[Tuple[str, str, str], float] = field(
        default_factory=dict,
    )
    _cached_remote_id: Dict[Tuple[str, str, str], Any] = field(
        default_factory=dict,
    )
    clock: Any = time.time  # injectable for tests; default wall-clock

    def _key(
        self, tenant_id: str, entity_id: str, comment_id: str,
    ) -> Tuple[str, str, str]:
        return (tenant_id, entity_id, comment_id)

    def is_within_window(
        self,
        tenant_id: str,
        entity_id: str,
        comment_id: str,
        now: float,
    ) -> bool:
        last = self._last_post_at.get(self._key(tenant_id, entity_id, comment_id))
        if last is None:
            return False
        return (now - last) < COMMENT_DEBOUNCE_SECONDS

    def cached_remote_id(
        self,
        tenant_id: str,
        entity_id: str,
        comment_id: str,
    ) -> Any:
        """The remote id from the original post, if it is
        still inside the debounce window. Returns `None`
        if the window has lapsed or the comment was never
        posted. The caller uses this for the debounce
        fast-path return value. The window check uses
        the injected `clock` so tests can advance time
        without sleeping."""
        if not self.is_within_window(
            tenant_id, entity_id, comment_id, self.clock(),
        ):
            return None
        return self._cached_remote_id.get(
            self._key(tenant_id, entity_id, comment_id)
        )

    def mark_posted(
        self,
        tenant_id: str,
        entity_id: str,
        comment_id: str,
        now: float,
        remote_id: Any,
    ) -> None:
        key = self._key(tenant_id, entity_id, comment_id)
        self._last_post_at[key] = now
        self._cached_remote_id[key] = remote_id


class GitHubIssuesAdapter(PlatformAdapter):
    """The day-one `PlatformAdapter` for GitHub Issues.
    Registers under `PORT_PLATFORM_GITHUB = "platform.github"`.

    The adapter is **stateless across tenants** apart
    from the per-tenant debounce index and the
    per-tenant installation token (the auth provider
    holds the token; the adapter just asks for it
    per call). Two tenants running through the same
    adapter instance see no cross-talk.

    Concurrency: a single `threading.Lock` guards
    the debounce index. The transport call itself
    is the caller's problem (the service's
    `InMemoryBurstControl.decide` is the gate; the
    transport call is downstream of the gate).

    FORA-433 (FORA-201.2) added `author_mapper` for
    the inbound comment webhook path and the
    `normalize_issue_comment_webhook` /
    `fetch_remote_comment` methods on top of the
    day-one `apply_mirror` / `health` contract."""

    name = "github"

    __slots__ = (
        "_auth",
        "_transport",
        "_audit",
        "_audit_forwarder",
        "_author_mapper",
        "_debounce",
        "_lock",
        "_default_repo",
        # FORA-437 (FORA-201.4 AC#4): the rate-limit
        # snapshot read by `health()` and surfaced via
        # `AdapterHealth.rate_limit_remaining` /
        # `rate_limit_reset`. Populated after every
        # transport response so the PollingBackstop
        # (11.7) sees the latest GitHub quota without
        # making its own API call. The `*_check_at`
        # slot is the wall-clock timestamp of the
        # most recent capture (ISO-8601, set by
        # `_record_rate_limit`).
        "_last_rate_limit_remaining",
        "_last_rate_limit_reset",
        "_last_rate_limit_check_at",
        # FORA-437: injectable clock so the smoke test
        # can advance the 30s debounce window
        # deterministically. Defaults to `time.time`;
        # tests pass a fake that returns a controlled
        # sequence of values.
        "_clock",
    )

    def __init__(
        self,
        *,
        auth: GitHubAuthProvider,
        transport: GitHubTransport,
        audit: Optional[GitHubAuditHook] = None,
        audit_forwarder: Optional[AuditForwarder] = None,
        author_mapper: Optional[GitHubAuthorMapper] = None,
        default_repo: Optional[str] = None,
        clock: Any = None,
    ) -> None:
        self._auth = auth
        self._transport = transport
        self._audit = audit or NullGitHubAuditHook()
        # `audit_forwarder` (FORA-201.5 / FORA-438 AC #5):
        # the canonical route for `sync.event.divergence_detected`
        # audit events. The FORA-204 daily drift report aggregates
        # over this forwarder; the local `audit` hook is kept
        # for the FORA-433 comment-ok audit path (the day-one
        # audit shape that was already wired).
        self._audit_forwarder = audit_forwarder
        # `author_mapper` is only used by the inbound
        # `normalize_issue_comment_webhook` path. A None
        # value means "no mappings configured" and any
        # inbound webhook raises `AuthorMappingError` —
        # the safe default per the FORA-201.2 verdict
        # invariant.
        self._author_mapper = author_mapper
        clock_fn = clock if clock is not None else time.time
        self._clock = clock_fn
        self._debounce = _DebounceIndex(clock=clock_fn)
        self._lock = threading.Lock()
        # `default_repo` is the `owner/repo` the adapter
        # writes to for the canonical Paperclip project.
        # Production: read from the tenant config.
        # Day-one: explicit constructor arg, the smoke
        # test passes `"fora-labs/sync-plane-fixture"`.
        self._default_repo = default_repo
        # FORA-437: rate-limit snapshot starts `None`;
        # the first transport call populates it via
        # `_record_rate_limit`. The PollingBackstop
        # (11.7) treats `None` as "never observed",
        # which is correct for a freshly-started
        # adapter.
        self._last_rate_limit_remaining: Optional[int] = None
        self._last_rate_limit_reset: Optional[int] = None
        self._last_rate_limit_check_at: str = ""

    # -- PlatformAdapter contract --------------------------------------

    def apply_mirror(
        self,
        tenant_id: str,
        entity: SyncEntity,
        *,
        comment: Optional[CanonicalComment] = None,
    ) -> MirrorResult:
        """Apply one mirror write to GitHub. The entity
        is the canonical state post-resolution; the
        optional comment is the canonical comment
        envelope (or None for entity-only writes).

        Behaviour:

          * If `entity.remote_refs["github"]` is set,
            PATCH the issue.
          * If not, POST a new issue and store the
            returned `number` in
            `entity.remote_refs["github"]`.
          * If `comment` is set, POST a new Issue
            comment (debounced) and store the
            `id` in
            `entity.remote_refs["github"][f"comment:{comment.comment_id}"]`.

        The method **does not mutate** `entity`; the
        service is the source of truth. The returned
        `MirrorResult` carries the new `remote_id`
        and the rate-limit snapshot for the service
        to thread into the audit log."""
        if entity.kind is not EntityKind.ISSUE:
            # GitHub Issues only knows `ISSUE`. RUN_STATUS
            # and INTERACTION are not mirrored here; the
            # resolver routes them elsewhere.
            return MirrorResult(
                ok=True,
                platform=self.name,
                remote_id="",
                metadata={"skipped": "non-issue entity"},
            )

        token = self._auth.installation_token(tenant_id)
        if not token:
            return MirrorResult(
                ok=False,
                platform=self.name,
                remote_id="",
                error="auth: no installation token for tenant",
            )

        repo = self._default_repo or _repo_for_tenant(tenant_id)
        if not repo:
            return MirrorResult(
                ok=False,
                platform=self.name,
                remote_id="",
                error="config: no default repo and no tenant->repo map",
            )

        existing_issue_number = entity.remote_refs.get(self.name)
        try:
            if existing_issue_number:
                issue_resp = self._update_issue(
                    token, repo, existing_issue_number, entity
                )
                issue_number = existing_issue_number
            else:
                issue_resp = self._create_issue(token, repo, entity)
                # `number` is what GitHub returns; it's the
                # portable id (the internal `id` is a 64-bit
                # number that's stable but opaque).
                issue_number = str(issue_resp.body.get("number", ""))
        except _GitHubAdapterError as exc:
            return MirrorResult(
                ok=False,
                platform=self.name,
                remote_id="",
                error=str(exc),
                metadata=exc.metadata,
            )

        comment_result_metadata: Dict[str, Any] = {}
        if comment is not None:
            cr, remote_comment_id = self._post_comment(
                tenant_id, token, repo, issue_number, entity, comment
            )
            if not cr.ok:
                return MirrorResult(
                    ok=False,
                    platform=self.name,
                    remote_id=issue_number,
                    error=cr.error or "comment post failed",
                    response_code=cr.status,
                    metadata={"comment_post": cr.body},
                )
            comment_result_metadata["comment_id"] = remote_comment_id
            # The canonical comment row stores the GitHub-
            # issued id under `remote_refs["github"][comment_id]`
            # (per the FORA-253 §6.1 envelope). The service
            # is responsible for merging this into the
            # persisted CanonicalComment row; the adapter
            # only surfaces it in `metadata` so the audit
            # + persistence flows share one shape.
            comment_result_metadata["remote_comment_refs"] = {
                "github": {comment.comment_id: remote_comment_id},
            }
            # FORA-433 AC #2 audit: outbound target comment
            # post succeeded. The hook is best-effort; a
            # failure here must not roll back the GitHub
            # write (the canonical state is already
            # consistent).
            try:
                self._audit.target_comment_ok(
                    tenant_id,
                    entity.entity_id,
                    comment_id=comment.comment_id,
                    remote_comment_id=remote_comment_id,
                    metadata={
                        "rate_limit_remaining": cr.rate_limit_remaining,
                        "rate_limit_reset": cr.rate_limit_reset,
                        "html_url": cr.body.get("html_url", ""),
                        "debounced": bool(cr.body.get("debounced")),
                    },
                )
            except Exception:  # pragma: no cover - audit is best-effort
                _log.exception(
                    "github.adapters.target_comment_audit_failed",
                    extra={
                        "tenant_id": tenant_id,
                        "entity_id": entity.entity_id,
                        "comment_id": comment.comment_id,
                    },
                )

        # Divergence check: did GitHub's response state
        # match what we requested? If not, surface the
        # event so the audit log can flag it.
        observed = GitHubState(
            state=str(issue_resp.body.get("state", "open")),
            state_reason=str(issue_resp.body.get("state_reason") or ""),
        )
        requested = _paperclip_status_to_gh(entity, _DAY_ONE_MAPPING)
        if requested and (observed.state != requested.state or
                          (requested.state_reason and
                           observed.state_reason != requested.state_reason)):
            try:
                self._audit.divergence_detected(
                    tenant_id,
                    entity.entity_id,
                    requested_state=requested,
                    observed_state=observed,
                    remote_response_status=issue_resp.status,
                )
            except Exception:  # pragma: no cover - audit is best-effort
                _log.exception(
                    "github.adapters.audit_failed",
                    extra={"tenant_id": tenant_id, "entity_id": entity.entity_id},
                )

        return MirrorResult(
            ok=True,
            platform=self.name,
            remote_id=issue_number,
            response_code=issue_resp.status,
            metadata={
                "rate_limit_remaining": issue_resp.rate_limit_remaining,
                "rate_limit_reset": issue_resp.rate_limit_reset,
                "html_url": issue_resp.body.get("html_url", ""),
                **comment_result_metadata,
            },
        )

    def health(self) -> AdapterHealth:
        """The adapter's current health. FORA-437
        (FORA-201.4 AC#4) threads the latest transport
        rate-limit snapshot into `rate_limit_remaining`
        so the PollingBackstop (11.7) sees the GitHub
        quota without making its own API call; the
        burst control uses the same value to short-
        circuit before consuming a token.

        `degraded` is True when the latest transport
        call reported `rate_limit_remaining <= 0` (the
        adapter is at the GitHub ceiling; new posts
        would 429 and the burst control would re-queue
        them anyway — calling the platform is
        pointless). The PollingBackstop uses this to
        route writes to the divergence queue instead
        of the live API.

        `consecutive_5xx` is reserved for a Phase 2
        bump; the day-one smoke asserts the field
        is present (so the wire shape is stable)
        but does not exercise it (the BurstControl
        circuit breaker is the live guard for now).
        `last_check_at` is the wall-clock ISO-8601
        string from the most recent transport
        response — the freshness signal the
        PollingBackstop uses to decide when to
        re-poll (stale >5 min triggers a refresh)."""
        from ..schema import now_iso  # local import to avoid cycle
        # `last_check_at` falls back to `now_iso()` on
        # a freshly-started adapter (no transport
        # response yet); the PollingBackstop treats a
        # missing `_last_rate_limit_check_at` the same
        # as a stale one.
        last_check_at = (
            self._last_rate_limit_check_at or now_iso()
        )
        degraded = (
            self._last_rate_limit_remaining is not None
            and self._last_rate_limit_remaining <= 0
        )
        return AdapterHealth(
            platform=self.name,
            degraded=degraded,
            consecutive_5xx=0,
            rate_limit_remaining=self._last_rate_limit_remaining,
            last_check_at=last_check_at,
        )

    # -- FORA-433 inbound webhook path -------------------------------

    def normalize_issue_comment_webhook(
        self,
        tenant_id: str,
        payload: Dict[str, Any],
        *,
        paperclip_issue_id: str,
    ) -> CanonicalComment:
        """Normalize a GitHub `issue_comment.created` (or
        `issue_comment.edited`) webhook payload into a
        canonical `CanonicalComment` per FORA-253 §6.1.

        Steps:
          1. Pull `comment.id`, `comment.body`,
             `comment.user.login`, `issue.number`,
             `repository.full_name` out of the payload.
             Missing fields raise `ValueError`.
          2. Resolve the GitHub author via
             `self._author_mapper.map_github_login`. If
             the mapper raises `AuthorMappingError`,
             re-raise; the FORA-201.2 verdict invariant
             is `never post as a Paperclip user`.
          3. Emit `sync.source.comment.ok` audit.
          4. Return the `CanonicalComment`. The
             `comment_id` here is a stable
             `github:<id>` prefix so the canonical
             store can dedupe on it (the GitHub id is
             globally unique per installation).

        `in_reply_to` is set when the inbound comment
        carries an `in_reply_to` payload field — the
        GitHub REST `comments` API does not expose
        parent ids; Phase 2 GraphQL threading will
        populate this from the
        `comments(first: 50, where: { replyTo: ... })`
        query. Day-one: the field stays empty and the
        renderer falls back to the plain `>` blockquote
        parent hint.
        """
        if self._author_mapper is None:
            raise AuthorMappingError(
                source_login=str(
                    (payload.get("comment") or {}).get(
                        "user", {}
                    ).get("login", "")
                ),
                reason="no GitHubAuthorMapper configured for the adapter",
            )
        comment_obj = payload.get("comment") or {}
        user_obj = comment_obj.get("user") or {}
        issue_obj = payload.get("issue") or {}
        repo_obj = payload.get("repository") or {}
        body_md = str(comment_obj.get("body") or "")
        source_login = str(user_obj.get("login") or "")
        gh_comment_id = comment_obj.get("id")
        if not body_md:
            raise ValueError(
                "github webhook: comment.body is empty; "
                "refusing to normalize"
            )
        if not source_login:
            raise ValueError(
                "github webhook: comment.user.login is empty; "
                "refusing to normalize"
            )
        if gh_comment_id is None:
            raise ValueError(
                "github webhook: comment.id is missing; "
                "refusing to normalize"
            )
        mapped = self._author_mapper.map_github_login(
            tenant_id, source_login
        )
        in_reply_to = str(
            comment_obj.get("in_reply_to") or ""
        )
        canonical = CanonicalComment(
            tenant_id=tenant_id,
            # `comment_id` is the canonical Paperclip-
            # issued id of the inbound comment. We
            # synthesize it as `github:<id>` so the
            # dedupe path can recognise a re-delivered
            # webhook on the bus and the canonical row
            # remains stable across retries.
            comment_id=f"github:{gh_comment_id}",
            paperclip_issue_id=paperclip_issue_id,
            author_kind=mapped.author_kind,
            author_id=mapped.author_id,
            author_display_name=mapped.author_display_name,
            body_md=body_md,
            remote_refs={
                "github": {
                    f"github:{gh_comment_id}": str(gh_comment_id),
                },
            },
            body_remote_rendered={
                "github": {
                    "rendered": _render_inbound_comment_blockquote(
                        body_md, in_reply_to or None,
                    ),
                },
            },
            in_reply_to=in_reply_to,
            metadata={
                "github_issue_number": issue_obj.get("number"),
                "github_repo": repo_obj.get("full_name"),
                "github_action": payload.get("action", ""),
            },
        )
        try:
            self._audit.source_comment_ok(
                tenant_id,
                paperclip_issue_id,
                comment_id=canonical.comment_id,
                source_login=source_login,
                metadata={
                    "github_repo": repo_obj.get("full_name"),
                    "github_issue_number": issue_obj.get("number"),
                    "github_action": payload.get("action", ""),
                    "mapped_author_id": mapped.author_id,
                },
            )
        except Exception:  # pragma: no cover - audit is best-effort
            _log.exception(
                "github.adapters.source_comment_audit_failed",
                extra={
                    "tenant_id": tenant_id,
                    "entity_id": paperclip_issue_id,
                    "comment_id": canonical.comment_id,
                },
            )
        return canonical

    def fetch_remote_comment(
        self,
        tenant_id: str,
        repo: str,
        issue_number: str,
        comment_id: str,
    ) -> GitHubResponse:
        """Re-read a single comment from GitHub via the
        GET `/repos/{owner}/{repo}/issues/comments/{id}`
        endpoint. Used by the round-trip smoke to verify
        that the comment we POSTed is the same comment
        the inbound webhook normalizer sees.

        Returns the `GitHubResponse` directly so the
        caller can inspect both the body and the
        rate-limit headers. A 404 means the comment
        was deleted on the remote (the canonical row
        should mark it tombstoned)."""
        token = self._auth.installation_token(tenant_id)
        if not token:
            return GitHubResponse(
                status=0,
                body={},
                headers={},
                error="auth: no installation token for tenant",
            )
        path = f"/repos/{repo}/issues/comments/{comment_id}"
        return self._transport.request("GET", path, token=token)

    # -- Internals -------------------------------------------------------

    def _create_issue(
        self,
        token: str,
        repo: str,
        entity: SyncEntity,
    ) -> GitHubResponse:
        payload: Dict[str, Any] = {
            "title": _entity_title(entity),
            "body": _entity_body(entity),
            "labels": _entity_labels(entity),
        }
        gh_state = _paperclip_status_to_gh(entity, _DAY_ONE_MAPPING)
        if gh_state and gh_state.state == "closed":
            payload["state"] = "closed"
            if gh_state.state_reason:
                payload["state_reason"] = gh_state.state_reason
        return self._transport.request(
            "POST", f"/repos/{repo}/issues",
            token=token, json_body=payload,
        )

    def _update_issue(
        self,
        token: str,
        repo: str,
        issue_number: str,
        entity: SyncEntity,
    ) -> GitHubResponse:
        payload: Dict[str, Any] = {
            "title": _entity_title(entity),
            "body": _entity_body(entity),
            "labels": _entity_labels(entity),
        }
        gh_state = _paperclip_status_to_gh(entity, _DAY_ONE_MAPPING)
        if gh_state is not None:
            payload["state"] = gh_state.state
            if gh_state.state == "closed" and gh_state.state_reason:
                payload["state_reason"] = gh_state.state_reason
        return self._transport.request(
            "PATCH", f"/repos/{repo}/issues/{issue_number}",
            token=token, json_body=payload,
        )

    def _post_comment(
        self,
        tenant_id: str,
        token: str,
        repo: str,
        issue_number: str,
        entity: SyncEntity,
        comment: CanonicalComment,
    ) -> "Tuple[GitHubResponse, Any]":
        """Post one comment to GitHub, or coalesce a
        repeat post inside the 30s debounce window.

        Returns `(response, remote_comment_id)`. On the
        debounce fast-path, `remote_comment_id` is the
        id of the original post (looked up from the
        debounce index). On the success path, it is the
        GitHub-issued numeric id from the POST response.
        On the failure path it is `None`.

        FORA-433 changed the return shape from a bare
        `GitHubResponse` to the `(response, remote_id)`
        tuple so the caller can surface the canonical
        `remote_refs["github"][comment_id]` map in
        `MirrorResult.metadata` without re-inspecting
        the response body."""
        now = time.time()
        with self._lock:
            cached_remote_id = self._debounce.cached_remote_id(
                tenant_id, entity.entity_id, comment.comment_id,
            )
            if cached_remote_id is not None:
                # Coalesce: return a synthetic 200 with the
                # cached id so the caller sees idempotency
                # without a second API call.
                return (
                    GitHubResponse(
                        status=200,
                        body={
                            "id": cached_remote_id,
                            "debounced": True,
                        },
                        headers={},
                    ),
                    cached_remote_id,
                )
        resp = self._transport.request(
            "POST", f"/repos/{repo}/issues/{issue_number}/comments",
            token=token,
            json_body={"body": _render_comment_body(comment)},
        )
        remote_comment_id: Any = None
        if resp.ok:
            remote_comment_id = resp.body.get("id")
            with self._lock:
                self._debounce.mark_posted(
                    tenant_id, entity.entity_id, comment.comment_id,
                    now, remote_comment_id,
                )
        return resp, remote_comment_id


# -- Helpers -----------------------------------------------------------------


def _repo_for_tenant(tenant_id: str) -> Optional[str]:
    """Tenant -> `owner/repo` lookup. Day-one: a single
    `FORA_DEFAULT_GITHUB_REPO` env var. Phase 2: a
    per-tenant config table loaded from the tenant
    settings store (FORA-126 broker)."""
    return os.environ.get("FORA_DEFAULT_GITHUB_REPO") or None


def _paperclip_status_to_gh(
    entity: SyncEntity, mapping: StatusMapping
) -> Optional[GitHubState]:
    """Read the Paperclip status from `entity.metadata` and
    return the mapped GitHub state. The status lives in
    `metadata["status"]` (the schema is defined by the
    service layer, not the adapter). Returns `None` if the
    entity has no status field — the caller treats that as
    "leave the existing remote state alone"."""
    status = entity.metadata.get("status")
    if not status:
        return None
    return mapping.to_github(str(status))


def _entity_title(entity: SyncEntity) -> str:
    """Title for the GitHub Issue. Pulled from
    `metadata["title"]` if present; otherwise a stable
    identifier-based title (so the adapter never posts
    a blank title)."""
    return str(entity.metadata.get("title") or f"FORA {entity.entity_id}")


def _entity_body(entity: SyncEntity) -> str:
    """Body for the GitHub Issue. Pulled from
    `metadata["body"]` if present; otherwise a thin
    Paperclip deep-link."""
    body = entity.metadata.get("body")
    if body:
        return str(body)
    return (
        f"Mirror of Paperclip issue `{entity.entity_id}` "
        f"(tenant `{entity.tenant_id}`).\n\n"
        f"Managed by the FORA Sync Plane — do not edit "
        f"the body directly; the next mirror will overwrite."
    )


def _entity_labels(entity: SyncEntity) -> list:
    """Day-one labels: 3 fixed labels (forge:pipeline,
    forge:tenant:<slug>, status-derived). The Jira
    sibling will copy this list verbatim. Custom
    per-tenant labels are a Phase 2 follow-up."""
    labels = ["forge:pipeline", f"forge:tenant:{entity.tenant_id}"]
    status = entity.metadata.get("status")
    if status:
        labels.append(f"forge:status:{status}")
    return labels


def _render_comment_body(comment: CanonicalComment) -> str:
    """Render a `CanonicalComment` as a GitHub Issue
    comment body. The body uses standard GitHub-Flavored
    Markdown; the attribution line at the top of the
    body is the user-visible author marker (GitHub
    Issues shows the App as the poster, not the human
    or agent)."""
    attribution = (
        f"> _Posted by **{comment.author_display_name}** "
        f"via FORA "
        f"(`{comment.author_kind}:{comment.author_id}`)_"
    )
    body = comment.body_md.strip()
    if comment.in_reply_to:
        body = f"> _(in reply to `{comment.in_reply_to}`)_\n\n{body}"
    return f"{attribution}\n\n{body}\n"


def _render_inbound_comment_blockquote(
    body_md: str,
    parent_comment_id: Optional[str],
) -> str:
    """Render an inbound GitHub comment as a Paperclip
    `>` blockquote. Per the FORA-201.2 plan §7, real
    GraphQL threading ships in Phase 2; day-one
    approximates the parent link with a `>` blockquote
    hint when `parent_comment_id` is known.

    The output is the value stored under
    `CanonicalComment.body_remote_rendered["github"]["rendered"]`
    so the downstream Paperclip comment render path can
    show the original GitHub body inline (rather than
    storing only the raw Markdown)."""
    body = body_md.strip()
    if not parent_comment_id:
        return body + "\n"
    return (
        f"> _Quoted from GitHub (parent `{parent_comment_id}`):_\n"
        f">\n"
        + "\n".join(f"> {line}" for line in body.splitlines())
        + "\n\n"
        + body
        + "\n"
    )


class _GitHubAdapterError(Exception):
    """An adapter-level error wrapping a non-2xx
    response with a metadata bag for the service's
    audit log."""
    def __init__(
        self,
        message: str,
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.metadata = metadata or {}
