"""step-78 F14 — async (files/batches/fine-tuning/responses) self-check.

Acceptance: structural coverage for the F14 surface. Run with:
  cd backend && PYTHONPATH=. python3 tests/services/test_async_f14.py

ponytail note
--------------
This file uses ``importlib.util.spec_from_file_location`` to load F14
modules without triggering the rest of the package init chain
(transitive imports of ``app.integrations.litellm.usage_query`` and
``app.db.session`` would otherwise pull ``asyncpg`` at module-init
time and break CI on hosts where it isn't installed). The structural
checks are happy to inspect the source directly.
"""

from __future__ import annotations

import ast
import importlib.util
import os
import sys

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_HERE = os.path.abspath(os.path.dirname(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", ".."))


def _load(name: str, relpath: str):  # type: ignore[no-untyped-def]
    """Load a module by file path, bypassing package init side-effects."""
    spec = importlib.util.spec_from_file_location(name, os.path.join(_BACKEND, relpath))
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {name} from {relpath}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _routes_for(relpath: str):  # type: ignore[no-untyped-def]
    """Return ``{(method, path)}`` from a FastAPI router source file via AST."""
    src = open(os.path.join(_BACKEND, relpath), encoding="utf-8").read()
    tree = ast.parse(src)

    # Look up the router's prefix (e.g. ``APIRouter(prefix="/forge")``).
    prefix = ""
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "router":  # noqa: SIM102
                    if isinstance(node.value, ast.Call):
                        for kw in node.value.keywords:
                            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                                prefix = kw.value.value or ""

    method_to_name = {
        "get": "GET",
        "post": "POST",
        "put": "PUT",
        "patch": "PATCH",
        "delete": "DELETE",
        "head": "HEAD",
        "options": "OPTIONS",
    }

    routes: set[tuple[str, str]] = set()
    for node in ast.walk(tree):
        # FastAPI handlers are async — match both FunctionDef and AsyncFunctionDef.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if (
                    isinstance(d, ast.Call)
                    and isinstance(d.func, ast.Attribute)
                    and isinstance(d.func.value, ast.Name)
                    and d.func.value.id == "router"
                    and d.func.attr in method_to_name
                ):
                    method = method_to_name[d.func.attr]
                    if d.args:
                        first = d.args[0]
                        if isinstance(first, ast.Constant) and isinstance(first.value, str):
                            joined = prefix.rstrip("/") + "/" + first.value.lstrip("/")
                            # collapse "//" just in case
                            while "//" in joined:
                                joined = joined.replace("//", "/")
                            routes.add((method, joined))
    return routes


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_async_client_group_methods_present():
    """a) AsyncClientGroup exposes every method from the spec."""
    mod = _load("async_client", "app/integrations/litellm/async_client.py")
    AsyncClientGroup = mod.AsyncClientGroup

    expected = {
        "files_create",
        "files_get",
        "files_delete",
        "files_content",
        "batches_create",
        "batches_get",
        "batches_cancel",
        "batches_list",
        "ft_jobs_create",
        "ft_jobs_get",
        "ft_jobs_cancel",
        "ft_jobs_list",
        "responses_create",
        "responses_get",
        "responses_cancel",
        "responses_input_items",
        "responses_compact",
    }
    actual = set(dir(AsyncClientGroup))
    missing = expected - actual
    assert not missing, f"AsyncClientGroup missing methods: {missing}"


def test_base_client_exposes_async_property():
    """b) LiteLLMBaseClient has `async` property — AST check (env-independent)."""
    src_path = os.path.join(_BACKEND, "app", "integrations", "litellm", "litellm_base_client.py")
    tree = ast.parse(open(src_path, encoding="utf-8").read())

    found = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for d in node.decorator_list:
                if isinstance(d, ast.Name) and d.id == "property" and node.name == "async_":
                    found = True
    assert found, "LiteLLMBaseClient has no `@property def async_(...)`"


def test_router_exposes_20_routes():
    """c) Router exposes the 20+ paths from the F14 contract."""
    routes = _routes_for("app/api/v1/forge_async.py")

    expected = {
        ("POST", "/forge/files"),
        ("GET", "/forge/files/{file_id}"),
        ("GET", "/forge/files/{file_id}/content"),
        ("DELETE", "/forge/files/{file_id}"),
        ("POST", "/forge/batches"),
        ("GET", "/forge/batches"),
        ("GET", "/forge/batches/{batch_id}"),
        ("POST", "/forge/batches/{batch_id}/cancel"),
        ("GET", "/forge/batches/{batch_id}/results"),
        ("POST", "/forge/fine-tuning/jobs"),
        ("GET", "/forge/fine-tuning/jobs"),
        ("GET", "/forge/fine-tuning/jobs/{job_id}"),
        ("POST", "/forge/fine-tuning/jobs/{job_id}/cancel"),
        ("POST", "/forge/responses"),
        ("GET", "/forge/responses/{response_id}"),
        ("GET", "/forge/responses/{response_id}/stream"),
        ("POST", "/forge/responses/{response_id}/cancel"),
        ("POST", "/forge/responses/{response_id}/input_items"),
        ("POST", "/forge/responses/compact"),
        ("POST", "/forge/jobs/ws"),
    }
    missing = expected - routes
    assert not missing, f"missing routes: {missing}"


def test_batch_results_accepts_jsonl_content():
    """d) BatchResultsResponse.model accepts jsonl_content: str."""
    from app.schemas.async_v2 import BatchResultsResponse

    resp = BatchResultsResponse(
        batch_id="b-1",
        output_file_id="file-xyz",
        jsonl_content='{"a":1}\n{"a":2}\n',
        line_count=2,
        parsed_lines=[{"a": 1}, {"a": 2}],
    )
    assert resp.jsonl_content == '{"a":1}\n{"a":2}\n'
    assert resp.line_count == 2


def test_response_read_status_field_accepts_set():
    """e) ResponseRead status accepts the documented enum set."""
    from app.schemas.async_v2 import ResponseRead, ResponseStatus

    for s in ("queued", "in_progress", "completed", "cancelled", "failed"):
        r = ResponseRead.model_validate({"id": "r-1", "status": s})
        assert r.status == ResponseStatus(s)
    r = ResponseRead.model_validate({"id": "r-1", "status": ResponseStatus.QUEUED})
    assert r.status is ResponseStatus.QUEUED


def test_file_read_has_bytes_int_field():
    """f) FileRead.bytes is an int."""
    from app.schemas.async_v2 import FileRead

    f = FileRead.model_validate({"id": "f-1", "purpose": "assistants", "bytes": 1024})
    assert f.bytes == 1024
    assert isinstance(f.bytes, int)


def test_error_codes_in_service_exceptions():
    """g) Service exceptions module exposes FineTuneUncancelable + BatchNotCancellable."""
    # ponytail: service import chain pulls asyncpg via
    # ``app.integrations.litellm.litellm_base_client``; inspect the AST
    # and re-execute ``AsyncError`` + ``ERROR_CODES`` definitions in an
    # isolated namespace.
    src = open(os.path.join(_BACKEND, "app/services/async_service.py"), encoding="utf-8").read()
    tree = ast.parse(src)

    # Collect the source fragments that define AsyncError + ERROR_CODES + async_service.
    captured: dict = {}

    class _Visitor(ast.NodeVisitor):
        def visit_ClassDef(self, node):  # noqa: D401
            if node.name == "AsyncError":
                captured["AsyncError"] = ast.unparse(node)
            self.generic_visit(node)

        def visit_Assign(self, node):  # noqa: D401
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "ERROR_CODES":
                    captured["ERROR_CODES"] = ast.unparse(node)
            self.generic_visit(node)

        def visit_AnnAssign(self, node):  # noqa: D401
            if isinstance(node.target, ast.Name) and node.target.id == "ERROR_CODES":
                # Render a plain Assign so the captured snippet executes.
                captured["ERROR_CODES"] = f"ERROR_CODES = {ast.unparse(node.value)}"
            self.generic_visit(node)

    _Visitor().visit(tree)

    ns: dict = {}
    assert "AsyncError" in captured and "ERROR_CODES" in captured, (
        "service source missing ERROR_CODES"
    )
    exec(compile(captured["AsyncError"], "async_service.AsyncError", "exec"), ns)  # noqa: S102
    exec(compile(captured["ERROR_CODES"], "async_service.ERROR_CODES", "exec"), ns)  # noqa: S102
    AsyncError = ns["AsyncError"]
    ERROR_CODES = ns["ERROR_CODES"]

    assert "fine_tune_uncancelable" in ERROR_CODES
    assert "batch_not_cancellable" in ERROR_CODES
    e = AsyncError("fine_tune_uncancelable", "nope")
    assert e.code == "fine_tune_uncancelable"
    assert "fine_tune_uncancelable" in str(e.detail)


def test_sse_endpoint_registered():
    """h) SSE endpoint registered at /forge/responses/{response_id}/stream."""
    routes = _routes_for("app/api/v1/forge_async.py")

    has_stream = ("GET", "/forge/responses/{response_id}/stream") in routes
    assert has_stream, "SSE stream endpoint missing"


if __name__ == "__main__":  # pragma: no cover
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FAIL {name}: {type(e).__name__}: {e}")
    sys.exit(failed)
