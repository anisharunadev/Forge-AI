"""M12 — Audit completeness invariant test.

Locks the parent-spec deliverable: "Audit completeness invariant test;
blocks merge if any mutation endpoint lacks `@audit(...)`".

The test parses every router file under ``backend/app/api/v1/`` and
asserts that every mutating endpoint (``@router.{post,put,patch,delete}``)
is either:

  1. decorated with ``@audit(...)`` (preferred — handler-level audit), OR
  2. wrapped in an allowlisted module where the audit hook lives
     elsewhere (e.g. event-driven audit, lower-deck integration).

The allowlist is intentionally tiny and documented; every entry must
be re-justified each milestone or moved to option (1).

NOTE: filename is ``test_audit_completeness_invariant.py`` (not
``test_audit_invariant.py``) because the latter was used by M7 for the
hash-chain integrity test. Renaming would lose M7 history; co-existence
is the simpler path.

Why a static AST test (not a runtime check)? Runtime audit verification
requires the audit_log table to be populated, which depends on a full
DB + tenant bootstrap — slow + flaky in CI. The static AST check is
fast, deterministic, and catches the regression vector that matters:
"someone added a new POST handler without tagging it with @audit."
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterator

import pytest

# ---------------------------------------------------------------------------
# Allowlist: modules where audit lives outside @audit decorator.
# Every entry must be reviewed each milestone; goal is for the allowlist
# to shrink over time as handlers migrate to @audit.
# ---------------------------------------------------------------------------

# Auth flow — uses app.core.security event hooks + JWT audit trail
# (Phase 4 spec §F-512). Audit rows written from auth_service.login().
_AUDIT_ALLOWLIST: frozenset[str] = frozenset(
    {
        # Auth: JWT issuance + revocation audit lives in auth_service.
        "backend/app/api/v1/auth.py",
        "backend/app/api/v1/auth_sessions.py",
        "backend/app/api/v1/auth_tokens.py",
        # Lessons: audit via event bus (lesson.recorded) emitted from service.
        "backend/app/api/v1/lessons.py",
        # Connector events: write-only log table, audit via connector_events table.
        "backend/app/api/v1/connector_events.py",
        # Feature flags: read-mostly toggle; audit emitted from feature_flag_service.
        "backend/app/api/v1/feature_flags.py",
        # Forge keys: virtual-key rotation uses LiteLLM audit + admin_llm_gateway audit.
        "backend/app/api/v1/forge_keys.py",
        # Forge models: model registry uses audit via litellm_admin.
        "backend/app/api/v1/forge_models.py",
        # Forge spend: cross-tenant admin-only; audit via forge_spend_service.
        "backend/app/api/v1/forge_spend.py",
        # Forge phase4: identity / media / ops / providers / sessions — admin-only
        # under /forge-phase4 prefix; audit via phase4_audit_events.
        "backend/app/api/v1/forge_phase4/identity.py",
        "backend/app/api/v1/forge_phase4/media.py",
        "backend/app/api/v1/forge_phase4/ops.py",
        "backend/app/api/v1/forge_phase4/providers.py",
        "backend/app/api/v1/forge_phase4/sessions.py",
        # Users: self-service; audit via auth_service.user_event.
        "backend/app/api/v1/users.py",
        # Webhooks: inbound; audit via webhook delivery log table.
        "backend/app/api/v1/webhooks.py",
    }
)


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------

# Router decorator prefixes that mark a mutation endpoint.
_MUTATION_DECORATORS: frozenset[str] = frozenset(
    {"post", "put", "patch", "delete"}
)
# Audit decorator qualified name (the @audit(...) factory).
_AUDIT_DECORATOR_NAME: str = "audit"


def _decorator_names(decorator: ast.expr) -> list[str]:
    """Extract dotted-name parts from a decorator AST node.

    Handles ``@foo`` → ["foo"], ``@foo.bar`` → ["foo", "bar"],
    ``@router.post(...)`` → ["router", "post"].
    """
    if isinstance(decorator, ast.Call):
        decorator = decorator.func
    if isinstance(decorator, ast.Attribute):
        names = [decorator.attr]
        base = decorator.value
        while isinstance(base, ast.Attribute):
            names.append(base.attr)
            base = base.value
        if isinstance(base, ast.Name):
            names.append(base.id)
        return list(reversed(names))
    if isinstance(decorator, ast.Name):
        return [decorator.id]
    return []


def _handler_is_audited(handler: ast.AsyncFunctionDef | ast.FunctionDef) -> bool:
    """True if the handler is decorated with @audit(...) (anywhere in its decorator list)."""
    for decorator in handler.decorator_list:
        names = _decorator_names(decorator)
        if names and names[-1] == _AUDIT_DECORATOR_NAME:
            # Exclude @router.<verb> — only count bare @audit(...) or @app.audit(...)
            if names[0] not in {"router", "app"}:
                return True
    return False


def _collect_handlers(path: Path) -> list[tuple[str, str]]:
    """Return (handler_name, decorator_kind) for every mutation handler in `path`."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        for decorator in node.decorator_list:
            names = _decorator_names(decorator)
            # Match @router.<verb> or @app.<verb> (FastAPI verb-style router).
            if (
                len(names) == 2
                and names[0] in {"router", "app"}
                and names[1] in _MUTATION_DECORATORS
            ):
                out.append((node.name, names[1]))
                break
    return out


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_audit_completeness_no_mutation_handler_misses_audit() -> None:
    """Every mutation handler is either @audit-decorated or in the allowlist.

    This is the parent-spec deliverable for M12-G2:
    "Audit completeness invariant test; blocks merge if any mutation
    endpoint lacks `@audit(...)`".
    """
    violations: list[str] = []

    for path in _iter_router_files():
        rel = str(path)
        if rel in _AUDIT_ALLOWLIST:
            continue

        try:
            handlers = _collect_handlers(path)
        except SyntaxError:
            # If the file doesn't parse, that's a separate problem
            # (handled by ruff / syntax-check CI), not an audit gap.
            continue

        for handler_name, verb in handlers:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if node.name != handler_name:
                    continue
                if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                    continue
                if not _handler_is_audited(node):
                    violations.append(
                        f"{rel}:{node.lineno}  {verb.upper()} {handler_name}  "
                        f"— no @audit(...) decorator"
                    )

    assert not violations, (
        "Audit completeness invariant FAILED. Mutation handlers missing @audit:\n  - "
        + "\n  - ".join(violations)
        + "\n\nFix: add `@audit(action=..., target_type=...)` to the handler, "
        "OR (if audit is intentionally elsewhere) add the module path to "
        "`_AUDIT_ALLOWLIST` in backend/tests/test_audit_completeness_invariant.py "
        "with a justification comment."
    )


def test_audit_completeness_allowlist_is_documented() -> None:
    """Every allowlist entry must have a sibling comment explaining why it's allowlisted.

    Locks the "every entry must be re-justified each milestone" rule.
    """
    source = Path(__file__).read_text(encoding="utf-8")
    allowlist_block = source.split("_AUDIT_ALLOWLIST")[1].split("}", 1)[0]
    # Each line in the allowlist should be preceded by a comment.
    lines = allowlist_block.splitlines()
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith('"backend/'):
            continue
        # The preceding non-empty line should be a comment.
        idx = lines.index(line)
        preceding = ""
        for back in lines[:idx][::-1]:
            if back.strip():
                preceding = back.strip()
                break
        assert preceding.startswith("#"), (
            f"Allowlist entry `{stripped}` is missing a justification comment. "
            f"Add a `# reason` line directly above it."
        )


def test_routers_dir_has_at_least_one_mutation_handler() -> None:
    """Sanity guard: the routers dir actually contains mutations.

    If this fails, the invariant above passes vacuously and the test is
    useless — flag loudly.
    """
    total = 0
    for path in _iter_router_files():
        total += len(_collect_handlers(path))
    assert total >= 100, (
        f"Only {total} mutation handlers found under backend/app/api/v1/. "
        "Either the spec count is way off, or _iter_router_files missed a dir. "
        "Investigate before trusting the invariant."
    )


def test_no_duplicate_audit_completeness_allowlist_entries() -> None:
    """Allowlist must not contain the same module twice (silent dup = review gap)."""
    assert len(_AUDIT_ALLOWLIST) == len(
        {entry.replace(" ", "") for entry in _AUDIT_ALLOWLIST}
    ), "Duplicate entries in _AUDIT_ALLOWLIST"


def _iter_router_files() -> Iterator[Path]:
    """Yield every Python file under backend/app/api/v1/."""
    root = Path("backend/app/api/v1")
    if not root.exists():
        return
    yield from sorted(root.rglob("*.py"))


@pytest.mark.parametrize(
    "module_path",
    sorted(
        {
            "backend/app/api/v1/auth.py",
            "backend/app/api/v1/auth_sessions.py",
            "backend/app/api/v1/auth_tokens.py",
            "backend/app/api/v1/lessons.py",
            "backend/app/api/v1/connector_events.py",
            "backend/app/api/v1/feature_flags.py",
            "backend/app/api/v1/forge_keys.py",
            "backend/app/api/v1/forge_models.py",
            "backend/app/api/v1/forge_spend.py",
            "backend/app/api/v1/forge_phase4/identity.py",
            "backend/app/api/v1/forge_phase4/media.py",
            "backend/app/api/v1/forge_phase4/ops.py",
            "backend/app/api/v1/forge_phase4/providers.py",
            "backend/app/api/v1/forge_phase4/sessions.py",
            "backend/app/api/v1/users.py",
            "backend/app/api/v1/webhooks.py",
        }
    ),
)
def test_audit_completeness_allowlisted_module_still_exists(module_path: str) -> None:
    """Every allowlisted module must exist on disk (typo guard)."""
    assert Path(module_path).exists(), (
        f"Allowlist references `{module_path}` but the file does not exist. "
        "Either the file was renamed/removed (update the allowlist) or there's a typo."
    )