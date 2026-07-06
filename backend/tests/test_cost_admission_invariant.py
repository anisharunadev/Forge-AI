"""M12 — Cost admission coverage invariant test.

Locks the parent-spec deliverable: "Cost admission coverage check
(every ``chat/completions`` call site preceded by ``pre_call_admission``)".

Strategy: parse ``backend/app/services/litellm_client.py`` and assert
that every public method that issues an LLM call is preceded by a
``self.pre_call_admission(...)`` call somewhere in its body. This
covers the canonical LLM client (4 known call sites: ``chat``,
``embed``, ``chat_with_tools``, ``agent_loop``).

A second guard asserts no raw ``litellm.completion`` / ``openai.chat``
calls exist anywhere outside ``litellm_client.py`` — the canonical
client is the *only* admission gate.

Forge chat SSE path (``backend/app/api/v1/forge_chat.py`` →
``backend/app/services/forge_chat.py``) is intentionally NOT covered by
this invariant because it uses a separate ``budget_guard.check_pre_call``
(per-agent ceiling) instead of the per-run/per-workflow cap enforced by
``pre_call_admission``. The two systems are complementary, not
redundant — see M12 spec §2 G3 for the design rationale.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _qualified_name(node: ast.expr) -> str | None:
    """Return dotted name for an Attribute or Name node, else None."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _qualified_name(node.value)
        if base is None:
            return None
        return f"{base}.{node.attr}"
    return None


def _iter_public_methods(tree: ast.Module) -> Iterator[ast.AsyncFunctionDef]:
    """Yield every async def at module level that doesn't start with ``_``."""
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef) and not node.name.startswith("_"):
            yield node


def _method_calls_pre_call_admission(method: ast.AsyncFunctionDef) -> bool:
    """True if `method` body contains `await self.pre_call_admission(...)`."""
    for node in ast.walk(method):
        if not isinstance(node, ast.Await):
            continue
        call = node.value
        if not isinstance(call, ast.Call):
            continue
        names = _qualified_name(call.func)
        if names == "self.pre_call_admission":
            return True
    return False


def _method_invokes_llm(method: ast.AsyncFunctionDef) -> bool:
    """True if `method` body makes an LLM call (heuristic).

    A method "invokes an LLM" if it calls any of:
      - ``self._impl.<verb>`` (canonical client wrapper around litellm)
      - ``self._legacy_chat`` / ``self._legacy_embed``
      - ``self._chat_stream``
      - ``self.client.<verb>``
    """
    triggers: set[str] = {
        "self._impl.completion",
        "self._impl.acompletion",
        "self._impl.embeddings",
        "self._impl.aembeddings",
        "self._legacy_chat",
        "self._legacy_embed",
        "self._chat_stream",
        "self.client.completion",
        "self.client.embeddings",
    }
    for node in ast.walk(method):
        if isinstance(node, ast.Call):
            names = _qualified_name(node.func)
            if names in triggers:
                return True
    return False


# ---------------------------------------------------------------------------
# Canonical LLM client invariants
# ---------------------------------------------------------------------------


LITELLM_CLIENT_PATH = Path("backend/app/services/litellm_client.py")


def _load_litellm_client_tree() -> ast.Module:
    return ast.parse(LITELLM_CLIENT_PATH.read_text(encoding="utf-8"))


def test_litellm_client_file_exists() -> None:
    """Sanity guard — the canonical client must be on disk."""
    assert LITELLM_CLIENT_PATH.exists(), (
        f"Canonical LLM client not found at {LITELLM_CLIENT_PATH}. "
        "If the file was renamed, update this invariant."
    )


def test_canonical_llm_methods_have_admission() -> None:
    """Every public method that invokes the LLM is preceded by pre_call_admission."""
    tree = _load_litellm_client_tree()
    violations: list[str] = []
    for method in _iter_public_methods(tree):
        if not _method_invokes_llm(method):
            continue
        if not _method_calls_pre_call_admission(method):
            violations.append(f"{LITELLM_CLIENT_PATH}:{method.lineno}  {method.name}()")

    assert not violations, (
        "Cost admission invariant FAILED. Public LLM methods missing "
        "`await self.pre_call_admission(...)`:\n  - "
        + "\n  - ".join(violations)
        + "\n\nFix: insert `await self.pre_call_admission(run_id=..., "
        "tenant_id=..., model=..., projected_cost_usd=...)` before any "
        "litellm.completion call."
    )


def test_pre_call_admission_method_is_async() -> None:
    """pre_call_admission must be async (called with await)."""
    tree = _load_litellm_client_tree()
    found = False
    for node in tree.body:
        if (
            isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
            and node.name == "pre_call_admission"
        ):
            found = True
            assert isinstance(node, ast.AsyncFunctionDef), (
                "pre_call_admission must be `async def` (callers use `await`)"
            )
    assert found, "pre_call_admission method missing from litellm_client.py"


# ---------------------------------------------------------------------------
# No-bypass guard: raw litellm / openai calls outside canonical client
# ---------------------------------------------------------------------------


def _iter_backend_python() -> Iterator[Path]:
    """Yield every Python file under backend/ except __pycache__/migrations."""
    root = Path("backend")
    if not root.exists():
        return
    for path in root.rglob("*.py"):
        parts = path.parts
        if "__pycache__" in parts:
            continue
        if "migrations" in parts:
            continue
        yield path


def test_no_raw_litellm_outside_canonical_client() -> None:
    """No ``litellm.completion(...)`` or ``openai.chat(...)`` calls outside litellm_client.py.

    Locks the parent-spec invariant: every LLM call routes through the
    canonical client where admission is enforced.
    """
    violations: list[str] = []
    triggers: set[str] = {
        "litellm.completion",
        "litellm.acompletion",
        "litellm.text_completion",
        "litellm.embedding",
        "openai.ChatCompletion.create",
        "openai.chat.completions.create",
        "AsyncOpenAI",
        "openai.AsyncClient",
    }

    for path in _iter_backend_python():
        if path.resolve() == LITELLM_CLIENT_PATH.resolve():
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            names = _qualified_name(node.func)
            if names and names in triggers:
                violations.append(f"{path}:{getattr(node, 'lineno', '?')}  call to `{names}`")

    assert not violations, (
        "Cost admission bypass detected. Raw LLM calls found outside "
        "litellm_client.py:\n  - "
        + "\n  - ".join(violations)
        + "\n\nRoute through LiteLLMClient.<verb>(...) so admission is enforced."
    )


# ---------------------------------------------------------------------------
# Forge chat path: budget_guard.check_pre_call acknowledgment
# ---------------------------------------------------------------------------


def test_forge_chat_uses_budget_guard() -> None:
    """forge_chat SSE path uses budget_guard.check_pre_call (separate per-agent gate).

    Documents that the forge_chat path uses a different admission
    mechanism than the canonical LiteLLMClient. This is intentional —
    the two systems are complementary (per-agent cap vs per-run/per-workflow cap).
    """
    forge_chat = Path("backend/app/services/forge_chat.py")
    assert forge_chat.exists(), "forge_chat.py missing — invariant is stale"

    source = forge_chat.read_text(encoding="utf-8")
    assert "budget_guard.check_pre_call" in source, (
        "forge_chat SSE path no longer calls budget_guard.check_pre_call. "
        "Either re-add the admission call or update this invariant + spec §2 G3."
    )


def test_budget_guard_method_exists() -> None:
    """budget_guard.check_pre_call must be defined (the forge_chat admission method)."""
    guard = Path("backend/app/services/forge_budget_guard.py")
    assert guard.exists()
    source = guard.read_text(encoding="utf-8")
    assert "async def check_pre_call" in source, (
        "budget_guard.check_pre_call method missing. "
        "If renamed, update forge_chat.py + this invariant."
    )
