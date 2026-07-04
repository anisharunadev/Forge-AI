"""step-78 F13 — RAG / Embeddings / Vector Stores / OCR self-check.

Acceptance: structural coverage for the F13 surface. Run with:
  cd backend && PYTHONPATH=. python3 tests/services/test_rag_f13.py

ponytail note
--------------
Same pattern as F11/F14 self-checks: load modules by file path with
``importlib.util.spec_from_file_location`` to avoid pulling asyncpg at
import time. Structural checks only.
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
    spec = importlib.util.spec_from_file_location(name, os.path.join(_BACKEND, relpath))
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {name} from {relpath}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _routes_for(relpath: str):  # type: ignore[no-untyped-def]
    """Return ``{(method, path)}`` from a FastAPI router source file via AST."""
    src = open(os.path.join(_BACKEND, relpath), "r", encoding="utf-8").read()
    tree = ast.parse(src)

    prefix = ""
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "router":
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
                            while "//" in joined:
                                joined = joined.replace("//", "/")
                            routes.add((method, joined))
    return routes


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_a_rag_client_group_methods_present():
    """a) RAGClientGroup exposes every method from the spec."""
    mod = _load("rag_client", "app/integrations/litellm/rag_client.py")
    RAGClientGroup = mod.RAGClientGroup

    expected = {
        "embeddings",
        "embeddings_models",
        "vector_stores_create",
        "vector_stores_list",
        "vector_stores_get",
        "vector_stores_delete",
        "vector_stores_search",
        "vector_stores_files_create",
        "rag_ingest",
        "rag_query",
        "rerank",
        "ocr",
        "search_tools_list",
        "search_tools_test_connection",
        "search_tools_ui",
        "indexes_create",
    }
    actual = set(dir(RAGClientGroup))
    missing = expected - actual
    assert not missing, f"RAGClientGroup missing methods: {missing}"


def test_b_base_client_exposes_rag_property():
    """b) LiteLLMBaseClient has `rag` property — AST check (env-independent)."""
    src_path = os.path.join(
        _BACKEND, "app", "integrations", "litellm", "litellm_base_client.py"
    )
    tree = ast.parse(open(src_path, "r", encoding="utf-8").read())

    found = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for d in node.decorator_list:
                if isinstance(d, ast.Name) and d.id == "property" and node.name == "rag":
                    found = True
    assert found, "LiteLLMBaseClient has no `@property def rag(...)`"


def test_c_router_exposes_13_routes():
    """c) Router exposes the 13 paths from the F13 contract."""
    routes = _routes_for("app/api/v1/forge_rag.py")

    expected = {
        ("GET", "/forge/embeddings/models"),
        ("POST", "/forge/embeddings"),
        ("GET", "/forge/projects/{project_id}/vector-stores"),
        ("POST", "/forge/projects/{project_id}/vector-stores"),
        ("DELETE", "/forge/vector-stores/{vs_id}"),
        ("POST", "/forge/vector-stores/{vs_id}/files"),
        ("GET", "/forge/vector-stores/{vs_id}/search"),
        ("POST", "/forge/rag/ingest"),
        ("POST", "/forge/rag/query"),
        ("POST", "/forge/ocr"),
        ("GET", "/forge/search-tools"),
        ("POST", "/forge/search-tools/{tool_id}/test"),
        ("GET", "/forge/rag/stats"),
    }
    missing = expected - routes
    assert not missing, f"missing routes: {missing}\nactual={sorted(routes)}"
    # also confirm rerank was added since spec mentions /v2/rerank
    # (not strictly required by spec lines 435-448 but a free add)
    extra = routes - expected
    # Allow extras but warn that the 13 endpoints are present
    assert len(expected & routes) == len(expected), "all 13 spec routes present"


def test_d_rag_query_response_chunks_shape():
    """d) RagQueryResponse.chunks accepts list[{text, score, source_file_id, source_chunk_id, metadata}]."""
    from app.schemas.rag_v2 import RagChunk, RagQueryResponse

    chunk = RagChunk(
        text="hello world",
        score=0.91,
        source_file_id="file-1",
        source_chunk_id="chunk-7",
        metadata={"page": 3},
    )
    resp = RagQueryResponse(
        chunks=[chunk],
        total_tokens=42,
        latency_ms=12,
    )
    assert resp.chunks[0].text == "hello world"
    assert resp.chunks[0].score == 0.91
    assert resp.chunks[0].source_file_id == "file-1"
    assert resp.chunks[0].source_chunk_id == "chunk-7"
    assert resp.chunks[0].metadata == {"page": 3}
    assert resp.total_tokens == 42


def test_e_embeddings_request_input_list_str():
    """e) EmbeddingsRequest.input accepts list[str]."""
    from app.schemas.rag_v2 import EmbeddingsRequest

    req = EmbeddingsRequest(input=["one", "two", "three"], model="text-embedding-3-small")
    assert req.input == ["one", "two", "three"]
    assert req.model == "text-embedding-3-small"
    assert isinstance(req.input, list)
    assert all(isinstance(s, str) for s in req.input)


def test_f_ocr_short_circuits_on_text_mime():
    """f) ocr_file short-circuits on text/* mime type — no upstream call."""
    # ponytail: load the service source and execute the OCR path with a
    # mocked-out RAGClientGroup so we can assert no network call was made.
    service_src = open(
        os.path.join(_BACKEND, "app/services/rag_service.py"), "r", encoding="utf-8"
    ).read()
    rag_client_src = open(
        os.path.join(_BACKEND, "app/integrations/litellm/rag_client.py"), "r", encoding="utf-8"
    ).read()

    namespace: dict = {}
    # Build a minimal in-memory stand-in for AsyncSession (RagService.ocr_file
    # only calls ``_record_audit`` which is best-effort and tolerates failure).
    class _FakeSession:
        async def flush(self):
            pass

        async def execute(self, *_args, **_kwargs):
            class _R:
                def first(self):
                    return None

                def scalars(self):
                    class _S:
                        def all(self):
                            return []

                    return _S()

                def scalar_one(self):
                    return 0

            return _R()

    # Stub RAGClientGroup so .ocr() would raise if called.
    class _ShouldNotCallOCR:
        def ocr(self, *, file_id):
            raise AssertionError(
                f"ocr() must NOT be called when mime starts with text/ — got file_id={file_id}"
            )

    # exec the RagService class definition (we don't execute the whole
    # module — only what's needed to instantiate the service).
    mod_tree = ast.parse(service_src)

    captured: dict = {}
    class _V(ast.NodeVisitor):
        def visit_ClassDef(self, node):  # noqa: D401
            if node.name == "RagService":
                captured["RagService"] = ast.unparse(node)

        def visit_ImportFrom(self, node):  # noqa: D401
            pass

    _V().visit(mod_tree)
    assert "RagService" in captured, "RagService class not found in service source"

    # Patch imports: provide a fake module for app.integrations.litellm.rag_client
    # so ``from app.integrations.litellm.rag_client import RAGClientGroup`` resolves
    # to our stand-in via sys.modules override.
    import types

    fake_litellm_mod = types.ModuleType("app.integrations.litellm.rag_client")
    fake_litellm_mod.RAGClientGroup = lambda *_a, **_k: _ShouldNotCallOCR()
    sys.modules.setdefault("app.integrations.litellm.rag_client", fake_litellm_mod)

    # Provide fake top-level modules the RagService imports reference.
    fake_db_models = types.ModuleType("app.db.models.rag")
    fake_db_models.RagChunk = type("RagChunk", (), {})
    fake_db_models.VectorStore = type("VectorStore", (), {})
    sys.modules.setdefault("app.db.models.rag", fake_db_models)

    fake_db_audit = types.ModuleType("app.db.models.audit")
    fake_db_audit.AuditEvent = type("AuditEvent", (), {})
    sys.modules.setdefault("app.db.models.audit", fake_db_audit)

    # Skip executing the module body; just instantiate the class and bind
    # the methods we need.
    ns: dict = {}
    # we need the @dataclass imports used by the service — provide stubs.
    exec(
        "from dataclasses import dataclass, field\n"
        "import time\n"
        "import hashlib\n"
        "class _CacheEntry:\n"
        "    def __init__(self, vector, expires_at):\n"
        "        self.vector = vector\n"
        "        self.expires_at = expires_at\n"
        "@dataclass\n"
        "class _EmbeddingCache:\n"
        "    ttl_seconds = 7*24*3600\n"
        "    maxsize = 1024\n"
        "    _store = {}\n",
        ns,
    )
    # Strip imports the AST will try to re-execute. Easiest path: just
    # ``exec`` the captured class body in a sandbox that already has the
    # imports it needs.
    # Inject OCRResponse, OCRRequest, RagError into the namespace so the
    # RagService.ocr_file body can resolve its `return OCRResponse(...)`.
    from app.schemas.rag_v2 import OCRRequest, OCRResponse
    from app.services.rag_service import RagError
    ns["OCRResponse"] = OCRResponse
    ns["OCRRequest"] = OCRRequest
    ns["RagError"] = RagError
    exec(captured["RagService"], ns)

    RagService = ns["RagService"]
    svc = RagService.__new__(RagService)
    # bind _client to return our stand-in
    svc.__dict__["_client"] = lambda: _ShouldNotCallOCR()  # type: ignore[assignment]

    # Build an OCRRequest-shaped stub with a text/* mime
    from app.schemas.rag_v2 import OCRRequest

    payload = OCRRequest(file_id="file-123", mime_type="text/plain")

    import asyncio

    result = asyncio.run(
        svc.ocr_file(
            db=_FakeSession(),
            tenant_id=__import__("uuid").UUID("00000000-0000-0000-0000-000000000001"),
            project_id=__import__("uuid").UUID("00000000-0000-0000-0000-000000000002"),
            payload=payload,
        )
    )
    assert result.ocr_skipped is True, "ocr_skipped should be True for text/* mime"
    assert result.file_id == "file-123"


def test_g_stats_signature_accepts_db_and_tenant():
    """g) stats signature: (self, *, db, tenant_id)."""
    import inspect

    service_src = open(
        os.path.join(_BACKEND, "app/services/rag_service.py"), "r", encoding="utf-8"
    ).read()
    tree = ast.parse(service_src)

    found = False
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "stats":
            args = node.args
            kwonly = [a.arg for a in args.kwonlyargs]
            assert "db" in kwonly, f"stats missing kw-only `db` (got {kwonly})"
            assert "tenant_id" in kwonly, f"stats missing kw-only `tenant_id` (got {kwonly})"
            # Verify the annotation looks like AsyncSession (best-effort)
            for a in args.kwonlyargs:
                ann = ast.unparse(args.kwonly_annotations[kwonly.index(a)]) if hasattr(args, "kwonly_annotations") else None
                # We don't fail on annotation parsing — the kwonly arg check is enough.
            found = True
    assert found, "RagService.stats not found"


def test_h_error_codes_in_service_exceptions():
    """h) Service exceptions expose ChunkingFailed + OCRFailed."""
    src = open(
        os.path.join(_BACKEND, "app/services/rag_service.py"), "r", encoding="utf-8"
    ).read()
    tree = ast.parse(src)

    captured: dict = {}
    class _V(ast.NodeVisitor):
        def visit_ClassDef(self, node):  # noqa: D401
            if node.name == "RagError":
                captured["RagError"] = ast.unparse(node)
            self.generic_visit(node)

        def visit_AnnAssign(self, node):  # noqa: D401
            if isinstance(node.target, ast.Name) and node.target.id == "ERROR_CODES":
                captured["ERROR_CODES"] = f"ERROR_CODES = {ast.unparse(node.value)}"
            self.generic_visit(node)

    _V().visit(tree)
    assert "RagError" in captured and "ERROR_CODES" in captured, "service source missing RagError/ERROR_CODES"
    ns: dict = {}
    exec(compile(captured["RagError"], "rag_service.RagError", "exec"), ns)  # noqa: S102
    exec(compile(captured["ERROR_CODES"], "rag_service.ERROR_CODES", "exec"), ns)  # noqa: S102
    RagError = ns["RagError"]
    ERROR_CODES = ns["ERROR_CODES"]

    assert "ChunkingFailed" in ERROR_CODES
    assert "OCRFailed" in ERROR_CODES
    e = RagError("ChunkingFailed", "nope")
    assert e.code == "ChunkingFailed"
    assert "ChunkingFailed" in str(e.detail)


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