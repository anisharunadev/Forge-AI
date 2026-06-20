"""API docs generator smoke + failure-mode test (FORA-119 / 7.1.3).

Runs the full acceptance battery from the FORA-119 spec:

1. **Sample run on a stub repo** with a REST + GraphQL + event
   surface → produces valid OpenAPI 3.0 + GraphQL SDL + AsyncAPI 2.x
   + markdown summary + doc diff; status=ok; 5 artifacts.
2. **OpenAPI structural validation** — the YAML is parseable, has
   `openapi: 3.0.3` at the root, an `info` block, `paths` with
   per-method operations, and a `components.securitySchemes` block.
   (The acceptance criterion calls for `openapi-cli validate`; that
   tool is not installed in the test env, so we assert the structural
   preconditions that the CLI checks first.)
3. **GraphQL SDL** has `type Query` (or `type Mutation` / `type
   Subscription`) and references all operation names.
4. **AsyncAPI** has `asyncapi: 2.6.0` and a `channels` block.
5. **Idempotency** — re-run with the same surface produces
   byte-identical bodies.
6. **Doc diff** — new/changed/removed endpoints are listed in
   `docs/api/diff.md` when the prior surface differs.
7. **Approval routing** — first-ever run is approval_required=True;
   re-run with identical surface is approval_required=False.
8. **Empty surface** — no REST/GraphQL/events → README carries
   `<!-- TODO(generated): -->` sentinels; OpenAPI / GraphQL / AsyncAPI
   still emit valid (if empty) docs.
9. **Dry-run mode** (`write=False`) returns a valid `DocGenOutput`
   but writes no files and does not mutate the doc index.
10. **Storage contract** — `DocIndex` carries entries with
    `kind=api_docs` and the on-disk `workspace/project/docs.md`
    is refreshed.
11. **Cross-linking** — when the ADR registry has matching entries,
    the README links to them; when it doesn't, the README still
    surfaces a "missing in registry" marker.
12. **Missing input_sha** → abort with `RunStatus.ABORTED` and a
    `MISSING_INPUT_SHA` error. The agent does not synthesise a SHA.

Run:

    python -m agents.documentation.api_docs_smoke_test

Writes evidence to `agents/documentation/evidence/api_docs_smoke_<timestamp>.json`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import List

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from agents.documentation.api_docs_generator import (  # noqa: E402
    ASYNCAPI_PATH,
    DIFF_PATH,
    GRAPHQL_SDL_PATH,
    OPENAPI_PATH,
    README_PATH,
    ApiDocsGenerator,
    ApiSurfaceSpec,
    AsyncEvent,
    DEFAULT_OUTPUT_DIR,
    GraphqlOperation,
    GraphqlType,
    RestEndpoint,
    compute_diff,
    render_asyncapi,
    render_graphql_sdl,
    render_openapi,
    render_readme,
    run_api_docs,
)
from agents.documentation.schemas import (  # noqa: E402
    CommitRange,
    DocGenInput,
    DocKind,
    ErrorKind,
    MemorySnapshot,
    RepoMetadata,
    RunStatus,
    now_iso,
)


FAILURES: List[str] = []


def assert_true(cond: bool, label: str) -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        FAILURES.append(label)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

SAMPLE_SURFACE = {
    "version": "1.0.0",
    "title": "Acme Public API",
    "description": "Sample surface for the FORA-119 acceptance battery.",
    "rest": [
        {
            "method": "POST",
            "path": "/v1/checkout/sessions",
            "operation_id": "createCheckoutSession",
            "summary": "Create a checkout session",
            "description": "Initiate a new checkout session and return a session id.",
            "tags": ["checkout"],
            "auth_scopes": ["checkout:write"],
            "request_schema": {
                "type": "object",
                "required": ["cart_id"],
                "properties": {"cart_id": {"type": "string"}},
            },
            "response_schema": {
                "type": "object",
                "required": ["session_id"],
                "properties": {"session_id": {"type": "string"}},
            },
            "error_codes": [400, 401, 409],
            "adr_refs": [1],
            "sample_request": {"cart_id": "cart_123"},
            "sample_response": {"session_id": "sess_abc"},
        },
        {
            "method": "GET",
            "path": "/v1/checkout/sessions/{id}",
            "operation_id": "getCheckoutSession",
            "summary": "Get a checkout session",
            "tags": ["checkout"],
            "auth_scopes": ["checkout:read"],
            "response_schema": {"type": "object"},
            "error_codes": [401, 404],
            "adr_refs": [1],
        },
    ],
    "graphql_operations": [
        {
            "kind": "query",
            "name": "checkoutSession",
            "description": "Fetch a checkout session",
            "args": [{"name": "id", "type": "ID", "required": True}],
            "returns": "CheckoutSession",
            "adr_refs": [1],
        },
        {
            "kind": "mutation",
            "name": "cancelSession",
            "description": "Cancel a session",
            "args": [{"name": "id", "type": "ID", "required": True}],
            "returns": "Boolean",
            "adr_refs": [],
        },
    ],
    "graphql_types": [
        {
            "name": "CheckoutSession",
            "kind": "type",
            "description": "A checkout session",
            "fields": [
                {"name": "id", "type": "ID", "required": True},
                {"name": "cartId", "type": "String", "required": True},
                {"name": "status", "type": "String", "required": False},
            ],
        },
    ],
    "events": [
        {
            "name": "OrderPlaced",
            "channel": "orders.placed",
            "description": "Emitted when an order is placed.",
            "payload_schema": {
                "type": "object",
                "required": ["order_id"],
                "properties": {"order_id": {"type": "string"}},
            },
            "adr_refs": [2],
            "sample_payload": {"order_id": "ord_123"},
        },
    ],
    "source_sha": "abc1234567",
}

SAMPLE_ADR_REGISTRY_BODY = (
    "---\n"
    "name: adr-registry\n"
    "version: 1.0\n"
    "spec: FORA-117\n"
    "owner: doc-agent\n"
    "status: production\n"
    "description: |\n"
    "  The ADR registry.\n"
    "---\n\n"
    "# ADR Registry\n\n"
    "```json\n"
    + json.dumps({
        "version": "1.0",
        "generated_at": "2026-06-17T00:00:00Z",
        "adr_registry_sha": "adr-seed-0001",
        "entries": [
            {
                "number": 1,
                "title": "Use Postgres for checkout store",
                "path": "docs/adr/0001-use-postgres.md",
                "status": "accepted",
                "date": "2026-06-17",
                "architecture_area": "knowledge-layer",
                "tags": ["storage", "checkout"],
                "supersedes": None,
                "superseded_by": None,
                "source_commit": "0000001",
                "last_generated_at": "2026-06-17T00:00:00Z",
            },
            {
                "number": 2,
                "title": "OrderPlaced event schema",
                "path": "docs/adr/0002-orderplaced-event.md",
                "status": "accepted",
                "date": "2026-06-17",
                "architecture_area": "events",
                "tags": ["events", "checkout"],
                "supersedes": None,
                "superseded_by": None,
                "source_commit": "0000001",
                "last_generated_at": "2026-06-17T00:00:00Z",
            },
        ],
    }, indent=2)
    + "\n```\n"
)

EMPTY_SURFACE = {"version": "1.0.0", "title": "Empty", "rest": [], "graphql_operations": [], "graphql_types": [], "events": [], "source_sha": "empty-sha"}


def _write_stub_repo(
    root: Path,
    *,
    surface: dict = None,
    with_adr_registry: bool = True,
    with_existing_openapi: bool = False,
) -> None:
    """Seed a stub repo with the FORA workspace convention files."""
    root.mkdir(parents=True, exist_ok=True)
    pmem = root / "workspace" / "project"
    pmem.mkdir(parents=True, exist_ok=True)
    surface = surface if surface is not None else SAMPLE_SURFACE
    (pmem / "api-surface.json").write_text(json.dumps(surface, indent=2), encoding="utf-8")
    if with_adr_registry:
        (pmem / "adr-registry.md").write_text(SAMPLE_ADR_REGISTRY_BODY, encoding="utf-8")
    # Seed an initial doc index with at least the README entry the
    # README generator would have written in a previous run.
    (pmem / "docs.md").write_text(
        "---\n"
        "name: doc-index\n"
        "version: 1.0\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  The v1 knowledge-layer surface.\n"
        "---\n\n"
        "# Doc Index — FORA Project\n\n"
        "```json\n"
        + json.dumps({
            "version": "1.0",
            "generated_at": "2026-06-17T00:00:00Z",
            "docs_index_sha": "v1-initial-seed",
            "entries": [
                {
                    "path": "README.md",
                    "kind": "readme",
                    "title": "Acme (seed)",
                    "last_generated_at": "2026-06-17T00:00:00Z",
                    "source_commit": "0000001",
                    "generator": "readme",
                    "version": "1.0",
                    "content_sha": "0" * 64,
                    "approval_required": False,
                    "tags": ["entry-point"],
                },
            ],
        }, indent=2)
        + "\n```\n",
        encoding="utf-8",
    )
    if with_existing_openapi:
        (root / "docs" / "api").mkdir(parents=True, exist_ok=True)
        # A minimal stub so the "first run" branch does not fire.
        (root / "docs" / "api" / "openapi.yaml").write_text(
            "openapi: 3.0.3\ninfo:\n  title: prior\n  version: 0.0.1\npaths: {}\n",
            encoding="utf-8",
        )


def _sample_input(input_sha: str = "abc1234567") -> DocGenInput:
    return DocGenInput(
        input_sha=input_sha,
        repo=RepoMetadata(
            owner="acme",
            name="sample",
            default_branch="main",
            license="Apache-2.0",
        ),
        commit_range=CommitRange(from_sha="0000001", to_sha="abc1234"),
        memory_snapshot=MemorySnapshot(
            project_memory_sha="pmem-aaaa",
            customer_memory_sha="cmem-bbbb",
            docs_index_sha="didx-cccc",
            adr_registry_sha="adr-dddd",
        ),
        requested_artifacts=[],
        model="claude-sonnet-4-6",
    )


# ---------------------------------------------------------------------------
# 1. Sample run on a stub repo
# ---------------------------------------------------------------------------

def test_sample_run_full_repo() -> None:
    print("\n[SAMPLE] full stub repo: REST + GraphQL + events")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_adr_registry=True, with_existing_openapi=False)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        assert_true(out.status == RunStatus.OK, "status=ok on full repo")
        assert_true(len(out.artifacts) == 5, "exactly 5 artifacts (openapi, graphql, asyncapi, readme, diff)")
        paths = {a.path for a in out.artifacts}
        assert_true(OPENAPI_PATH in paths, f"openapi artifact produced at {OPENAPI_PATH}")
        assert_true(GRAPHQL_SDL_PATH in paths, f"graphql artifact produced at {GRAPHQL_SDL_PATH}")
        assert_true(ASYNCAPI_PATH in paths, f"asyncapi artifact produced at {ASYNCAPI_PATH}")
        assert_true(README_PATH in paths, f"readme artifact produced at {README_PATH}")
        assert_true(DIFF_PATH in paths, f"diff artifact produced at {DIFF_PATH}")
        # All artifacts carry freshness + source_sha
        for a in out.artifacts:
            assert_true(a.freshness_timestamp, f"{a.path}: freshness_timestamp present")
            assert_true(a.source_sha == "abc1234567", f"{a.path}: source_sha echoed from input")
            assert_true(a.generator_type.value == "api_docs", f"{a.path}: generator_type=api_docs")
        # File on disk
        assert_true((root / OPENAPI_PATH).exists(), f"{OPENAPI_PATH} written to repo root")
        assert_true((root / GRAPHQL_SDL_PATH).exists(), f"{GRAPHQL_SDL_PATH} written")
        assert_true((root / ASYNCAPI_PATH).exists(), f"{ASYNCAPI_PATH} written")
        assert_true((root / README_PATH).exists(), f"{README_PATH} written")
        assert_true((root / DIFF_PATH).exists(), f"{DIFF_PATH} written")


# ---------------------------------------------------------------------------
# 2. OpenAPI structural validation (the openapi-cli validate preconditions)
# ---------------------------------------------------------------------------

def test_openapi_validates() -> None:
    print("\n[OPENAPI] OpenAPI 3.0 structural validation")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        openapi_body = (root / OPENAPI_PATH).read_text(encoding="utf-8")
        # Parseable as YAML
        doc = yaml.safe_load(openapi_body)
        assert_true(isinstance(doc, dict), "openapi.yaml parses as a YAML mapping")
        assert_true(doc.get("openapi") == "3.0.3", f"openapi version = 3.0.3 (got {doc.get('openapi')!r})")
        info = doc.get("info", {})
        assert_true(info.get("title"), "openapi: info.title present")
        assert_true(info.get("version"), "openapi: info.version present")
        paths = doc.get("paths", {})
        assert_true(isinstance(paths, dict) and paths, "openapi: paths block non-empty")
        # Per-endpoint checks
        post_op = paths.get("/v1/checkout/sessions", {}).get("post")
        assert_true(post_op is not None, "openapi: POST /v1/checkout/sessions present")
        assert_true(post_op.get("operationId") == "createCheckoutSession", "openapi: operationId echoed")
        assert_true(post_op.get("security") == [{"BearerAuth": ["checkout:write"]}], "openapi: security scopes echoed")
        assert_true("200" in post_op.get("responses", {}), "openapi: 200 response present")
        for code in (400, 401, 409):
            assert_true(str(code) in post_op.get("responses", {}), f"openapi: error code {code} present")
        # Path parameter extraction
        get_op = paths.get("/v1/checkout/sessions/{id}", {}).get("get")
        assert_true(get_op is not None, "openapi: GET /v1/checkout/sessions/{id} present")
        params = get_op.get("parameters", [])
        assert_true(any(p.get("name") == "id" for p in params), "openapi: {id} path parameter extracted")
        # securitySchemes
        schemes = doc.get("components", {}).get("securitySchemes", {})
        assert_true("BearerAuth" in schemes, "openapi: components.securitySchemes.BearerAuth present")
        # x-adr-refs extension
        assert_true(post_op.get("x-adr-refs") == ["docs/adr/0001.md"], "openapi: x-adr-refs extension emitted")


# ---------------------------------------------------------------------------
# 3. GraphQL SDL
# ---------------------------------------------------------------------------

def test_graphql_sdl_has_query_and_mutation() -> None:
    print("\n[GRAPHQL] GraphQL SDL: type Query + type Mutation + operations")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        body = (root / GRAPHQL_SDL_PATH).read_text(encoding="utf-8")
        assert_true("type Query" in body, "graphql: type Query block present")
        assert_true("type Mutation" in body, "graphql: type Mutation block present")
        assert_true("checkoutSession" in body, "graphql: query operation name present")
        assert_true("cancelSession" in body, "graphql: mutation operation name present")
        assert_true("type CheckoutSession" in body, "graphql: type CheckoutSession present")


# ---------------------------------------------------------------------------
# 4. AsyncAPI
# ---------------------------------------------------------------------------

def test_asyncapi_has_channels() -> None:
    print("\n[ASYNCAPI] AsyncAPI: asyncapi: 2.6.0 + channels block")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        body = (root / ASYNCAPI_PATH).read_text(encoding="utf-8")
        doc = yaml.safe_load(body)
        assert_true(doc.get("asyncapi") == "2.6.0", f"asyncapi version = 2.6.0 (got {doc.get('asyncapi')!r})")
        channels = doc.get("channels", {})
        assert_true("orders.placed" in channels, "asyncapi: orders.placed channel present")
        components = doc.get("components", {}).get("messages", {})
        assert_true("OrderPlaced" in components, "asyncapi: OrderPlaced message present")


# ---------------------------------------------------------------------------
# 5. Idempotency
# ---------------------------------------------------------------------------

def test_idempotency_same_input_same_bytes() -> None:
    print("\n[IDEMPOTENCY] same input -> same content_sha, same body")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out_a = run_api_docs(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        out_b = run_api_docs(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        for aa, bb in zip(out_a.artifacts, out_b.artifacts):
            assert_true(aa.content_sha == bb.content_sha, f"{aa.path}: content_sha identical on re-run")
            assert_true(aa.content == bb.content, f"{aa.path}: body byte-identical on re-run")


# ---------------------------------------------------------------------------
# 6. Doc diff (new / changed / removed)
# ---------------------------------------------------------------------------

def test_doc_diff_detects_new_endpoint() -> None:
    print("\n[DIFF] new endpoint surfaces in diff.md")
    # Use the renderer-level diff helper so we don't depend on a prior
    # surface being on disk (the generator's I/O doesn't track the
    # prior surface as a structured file).
    prior = ApiSurfaceSpec.from_dict({
        **SAMPLE_SURFACE,
        "rest": SAMPLE_SURFACE["rest"][:1],   # only the POST endpoint
    })
    current = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    diff = compute_diff(prior, current)
    body = diff.render()
    assert_true("GET /v1/checkout/sessions/{id}" in body, "diff: new GET endpoint listed")
    assert_true("## Added" in body, "diff: Added section present")
    # Verify the diff is also written to disk by run_api_docs when
    # the surface changes between runs (we just check the render
    # here; the I/O is covered in #1).
    assert_true(diff.changed or diff.added, "diff: at least one add or change reported")


def test_doc_diff_no_changes_when_surface_identical() -> None:
    print("\n[DIFF] identical surface -> empty diff")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    diff = compute_diff(spec, spec)
    assert_true(diff.is_empty(), "diff: identical surface produces empty diff")
    body = diff.render()
    assert_true("No new, changed, or removed endpoints" in body, "diff: empty diff body says so")


# ---------------------------------------------------------------------------
# 7. Approval routing
# ---------------------------------------------------------------------------

def test_approval_routing_routine_update() -> None:
    print("\n[APPROVAL] first run approval_required=True; identical re-run approval_required=False")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_existing_openapi=False)
        out_first = run_api_docs(_sample_input(input_sha="apr-sha"), repo_root=root, write=True)
        for a in out_first.artifacts[:4]:   # openapi, graphql, asyncapi, readme (diff is informational)
            assert_true(a.approval_required is True, f"{a.path}: first run is approval_required=True (publication)")
        out_second = run_api_docs(_sample_input(input_sha="apr-sha"), repo_root=root, write=True)
        for a in out_second.artifacts[:4]:
            assert_true(a.approval_required is False, f"{a.path}: identical re-run is approval_required=False (no-op)")
        # The diff artifact is always informational
        diff_artifact = [a for a in out_first.artifacts if a.path == DIFF_PATH][0]
        assert_true(diff_artifact.approval_required is False, "diff.md is always approval_required=False (informational)")


# ---------------------------------------------------------------------------
# 8. Empty surface -> TODO sentinels
# ---------------------------------------------------------------------------

def test_empty_surface_emits_todo_sentinels() -> None:
    print("\n[EMPTY-SURFACE] no endpoints -> TODO sentinels in README")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, surface=EMPTY_SURFACE)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        assert_true(out.status == RunStatus.OK, "empty surface still produces status=ok")
        readme = (root / README_PATH).read_text(encoding="utf-8")
        assert_true("<!-- TODO(generated):" in readme, "empty surface: TODO sentinel in README")
        # OpenAPI / GraphQL / AsyncAPI still emit valid docs
        openapi = yaml.safe_load((root / OPENAPI_PATH).read_text(encoding="utf-8"))
        assert_true(openapi.get("openapi") == "3.0.3", "empty surface: OpenAPI doc still valid")
        graphql = (root / GRAPHQL_SDL_PATH).read_text(encoding="utf-8")
        assert_true("<!-- TODO(generated):" in graphql, "empty surface: GraphQL SDL has TODO sentinel")
        asyncapi = yaml.safe_load((root / ASYNCAPI_PATH).read_text(encoding="utf-8"))
        assert_true(asyncapi.get("asyncapi") == "2.6.0", "empty surface: AsyncAPI doc still valid")


# ---------------------------------------------------------------------------
# 9. Dry-run mode
# ---------------------------------------------------------------------------

def test_dry_run_does_not_write() -> None:
    print("\n[DRY-RUN] write=False leaves no file and no doc-index mutation")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        idx_path = root / "workspace" / "project" / "docs.md"
        before = idx_path.read_text(encoding="utf-8")
        out = run_api_docs(_sample_input(), repo_root=root, write=False)
        assert_true(len(out.artifacts) == 5, "dry-run: 5 artifacts still produced")
        for path in (OPENAPI_PATH, GRAPHQL_SDL_PATH, ASYNCAPI_PATH, README_PATH, DIFF_PATH):
            assert_true(not (root / path).exists(), f"dry-run: {path} NOT written")
        after = idx_path.read_text(encoding="utf-8")
        assert_true(before == after, "dry-run: doc index NOT mutated")


# ---------------------------------------------------------------------------
# 10. Storage contract
# ---------------------------------------------------------------------------

def test_storage_contract_doc_index_entries() -> None:
    print("\n[STORAGE] DocIndex entries have FORA-117 shape (kind=api_docs)")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        assert_true(out.doc_index is not None, "doc_index present (FORA-117)")
        assert_true(out.adr_registry is not None, "adr_registry present (FORA-117)")
        api_entries = [e for e in out.doc_index.entries if e.kind == DocKind.API_DOCS]
        assert_true(len(api_entries) >= 4, f"at least 4 api_docs entries (got {len(api_entries)})")
        for e in api_entries:
            assert_true(e.last_generated_at, f"{e.path}: last_generated_at present")
            assert_true(e.source_commit == "abc1234567", f"{e.path}: source_commit echoed")
            assert_true(e.content_sha, f"{e.path}: content_sha cached")
            assert_true(e.version == "1.0", f"{e.path}: version = 1.0")
        # On-disk doc index has the api_docs entries
        idx_path = root / "workspace" / "project" / "docs.md"
        idx_body = idx_path.read_text(encoding="utf-8")
        assert_true(f'"path": "{OPENAPI_PATH}"' in idx_body, "doc index has openapi entry")
        assert_true(f'"path": "{GRAPHQL_SDL_PATH}"' in idx_body, "doc index has graphql entry")
        assert_true(f'"path": "{ASYNCAPI_PATH}"' in idx_body, "doc index has asyncapi entry")
        assert_true(f'"path": "{README_PATH}"' in idx_body, "doc index has readme entry")
        # README seed entry preserved
        assert_true('"path": "README.md"' in idx_body, "existing README seed preserved")
        # Frontmatter preserved
        assert_true("spec: FORA-117" in idx_body, "doc index frontmatter intact")


# ---------------------------------------------------------------------------
# 11. Cross-linking to ADRs
# ---------------------------------------------------------------------------

def test_cross_linking_to_adrs() -> None:
    print("\n[CROSSLINK] ADR cross-links from README + OpenAPI")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_adr_registry=True)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        readme = (root / README_PATH).read_text(encoding="utf-8")
        # ADR 1 in the registry: "Use Postgres for checkout store"
        assert_true("docs/adr/0001-use-postgres.md" in readme, "cross-link: ADR 1 linked from README")
        # ADR 2 in the registry: "OrderPlaced event schema"
        assert_true("docs/adr/0002-orderplaced-event.md" in readme, "cross-link: ADR 2 linked from README")


def test_cross_linking_missing_in_registry() -> None:
    print("\n[CROSSLINK] missing ADR surfaces a 'missing in registry' marker")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_adr_registry=False)
        out = run_api_docs(_sample_input(), repo_root=root, write=True)
        readme = (root / README_PATH).read_text(encoding="utf-8")
        # The sample surface links to ADR 1, which is NOT in the registry.
        assert_true("missing in registry" in readme, "missing ADR surfaced with explicit marker")


# ---------------------------------------------------------------------------
# 12. Missing input_sha -> MISSING_INPUT_SHA
# ---------------------------------------------------------------------------

def test_missing_input_sha_aborts() -> None:
    print("\n[FAILURE-MODE] MISSING_INPUT_SHA -> RunStatus.ABORTED")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        inp = _sample_input()
        inp.input_sha = None
        out = run_api_docs(inp, repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "missing input_sha -> RunStatus.ABORTED")
        assert_true(len(out.errors) >= 1, "at least one error reported")
        assert_true(
            out.errors[0].kind == ErrorKind.MISSING_INPUT_SHA,
            "error kind = MISSING_INPUT_SHA",
        )
        # No file written
        for path in (OPENAPI_PATH, GRAPHQL_SDL_PATH, ASYNCAPI_PATH, README_PATH, DIFF_PATH):
            assert_true(not (root / path).exists(), f"no {path} written on aborted run")


# ---------------------------------------------------------------------------
# 13. Renderer unit tests (pure)
# ---------------------------------------------------------------------------

def test_renderer_openapi_pure_idempotent() -> None:
    print("\n[RENDERER] render_openapi is deterministic")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    body_a = render_openapi(spec)
    body_b = render_openapi(spec)
    assert_true(body_a == body_b, "render_openapi: same inputs -> same bytes")
    assert_true(
        hashlib.sha256(body_a.encode()).hexdigest()
        == hashlib.sha256(body_b.encode()).hexdigest(),
        "render_openapi: sha256 of body identical",
    )


def test_renderer_graphql_pure_idempotent() -> None:
    print("\n[RENDERER] render_graphql_sdl is deterministic")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    body_a = render_graphql_sdl(spec)
    body_b = render_graphql_sdl(spec)
    assert_true(body_a == body_b, "render_graphql_sdl: same inputs -> same bytes")


def test_renderer_asyncapi_pure_idempotent() -> None:
    print("\n[RENDERER] render_asyncapi is deterministic")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    body_a = render_asyncapi(spec)
    body_b = render_asyncapi(spec)
    assert_true(body_a == body_b, "render_asyncapi: same inputs -> same bytes")


def test_renderer_readme_pure_idempotent() -> None:
    print("\n[RENDERER] render_readme is deterministic")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    body_a = render_readme(spec, adr_index={})
    body_b = render_readme(spec, adr_index={})
    assert_true(body_a == body_b, "render_readme: same inputs -> same bytes")


def test_renderer_omits_wall_clock_from_body() -> None:
    print("\n[RENDERER] no wall-clock timestamp in artifact bodies")
    spec = ApiSurfaceSpec.from_dict(SAMPLE_SURFACE)
    iso_re = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
    for label, body in (
        ("openapi", render_openapi(spec)),
        ("graphql", render_graphql_sdl(spec)),
        ("asyncapi", render_asyncapi(spec)),
        ("readme", render_readme(spec, adr_index={})),
    ):
        assert_true(iso_re.search(body) is None, f"{label}: no ISO 8601 timestamp in body")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("[api-docs-smoke] FORA-119 / 7.1.3 acceptance battery")
    test_sample_run_full_repo()
    test_openapi_validates()
    test_graphql_sdl_has_query_and_mutation()
    test_asyncapi_has_channels()
    test_idempotency_same_input_same_bytes()
    test_doc_diff_detects_new_endpoint()
    test_doc_diff_no_changes_when_surface_identical()
    test_approval_routing_routine_update()
    test_empty_surface_emits_todo_sentinels()
    test_dry_run_does_not_write()
    test_storage_contract_doc_index_entries()
    test_cross_linking_to_adrs()
    test_cross_linking_missing_in_registry()
    test_missing_input_sha_aborts()
    test_renderer_openapi_pure_idempotent()
    test_renderer_graphql_pure_idempotent()
    test_renderer_asyncapi_pure_idempotent()
    test_renderer_readme_pure_idempotent()
    test_renderer_omits_wall_clock_from_body()

    # Persist evidence
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"api_docs_smoke_{stamp}.json"
    summary = {
        "spec": "FORA-119",
        "sub_goal": "7.1.3 API docs generator",
        "ran_at": now_iso(),
        "tests_run": 19,
        "assertions_failed": len(FAILURES),
        "failures": FAILURES,
        "acceptance": {
            "sample_run": "PASS",
            "openapi_structural_validation": "PASS",
            "graphql_sdl": "PASS",
            "asyncapi": "PASS",
            "idempotency": "PASS",
            "doc_diff_new": "PASS",
            "doc_diff_identical": "PASS",
            "approval_routing": "PASS",
            "empty_surface_todo": "PASS",
            "dry_run": "PASS",
            "storage_contract": "PASS",
            "crosslink_adrs": "PASS",
            "crosslink_missing_adr": "PASS",
            "missing_input_sha": "PASS",
            "renderer_pure_openapi": "PASS",
            "renderer_pure_graphql": "PASS",
            "renderer_pure_asyncapi": "PASS",
            "renderer_pure_readme": "PASS",
            "no_wall_clock": "PASS",
        } if not FAILURES else "see failures",
    }
    evidence_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[api-docs-smoke] wrote {evidence_path}")
    if FAILURES:
        print(f"\n[api-docs-smoke] FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[api-docs-smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
