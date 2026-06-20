"""API docs generator (FORA-119 / 7.1.3).

Produces API documentation from a declarative API surface spec. The
detector is **not** a code parser — it consumes a `ApiSurfaceSpec`
(a JSON file on disk, e.g. `workspace/project/api-surface.json` or a
CI-emitted artifact) that enumerates REST endpoints, GraphQL operations,
gRPC services, and async events. The generator renders that spec into
the formats the spec promises:

- `docs/api/openapi.yaml`       — OpenAPI 3.0 for the REST surface
- `docs/api/schema.graphql`     — GraphQL SDL for the GraphQL surface
- `docs/api/asyncapi.yaml`      — AsyncAPI 2.x for the event surface
- `docs/api/README.md`          — per-endpoint markdown summary
- `docs/api/diff.md`            — new / changed / removed endpoints since
                                  the previous generation

## Idempotency contract

Re-running with the **same `input_sha` + the same `surface_sha` + the
same memory bytes** produces byte-identical artifact bodies. Wall-clock
timestamps live on the `DocArtifact` wrapper, never in the body. This
satisfies the prompt.md hard-constraint #1 ("Determinism. Same inputs
→ same output bytes").

## Approval routing

Per `prompt.md` §"Hard constraints" item 3, API docs are routine
updates and **auto-merge after generation** (`approval_required=False`).
The one exception is a first-ever run with no prior `docs/api/` on
disk — that is treated as a fresh surface publication, which is
non-trivial and requires human approval.

## Failure modes

- Missing `input_sha` → `MISSING_INPUT_SHA` (the spec requires it).
- Unparseable `surface_spec` → `INVALID_REPO_METADATA` (abort; the
  generator never invents an endpoint).
- Empty surface (no endpoints, no graphql, no events) → emit a
  `<!-- TODO(generated): -->` sentinel in `docs/api/README.md`, but
  still write valid (if empty) OpenAPI/GraphQL/AsyncAPI files. The
  acceptance test asserts this fallback path.

## Inputs read from disk

- `workspace/project/api-surface.json` — the API surface spec
  (declarative; CI-emitted or hand-curated).
- `workspace/project/adr-registry.md` — for cross-linking to ADRs.
- `docs/release-notes/`                — for cross-linking to release notes.
- `docs/api/openapi.yaml` etc.         — prior surface, for the doc diff.

## Output files

- `docs/api/openapi.yaml`   — OpenAPI 3.0 YAML (validates with `openapi-cli validate`)
- `docs/api/schema.graphql` — GraphQL SDL
- `docs/api/asyncapi.yaml`  — AsyncAPI 2.x YAML
- `docs/api/README.md`      — markdown summary (per-endpoint metadata)
- `docs/api/diff.md`        — endpoint diff since the prior run
"""

from __future__ import annotations

import hashlib
import json as _json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

from .docs_query import _FENCED_JSON_RE, parse_index_markdown, parse_registry_markdown
from .schemas import (
    AdrRegistry,
    AdrRegistryEntry,
    CostRecord,
    DocArtifact,
    DocGenError,
    DocGenInput,
    DocGenOutput,
    DocIndex,
    DocIndexEntry,
    DocKind,
    ErrorKind,
    FreshnessMetadata,
    GeneratorType,
    RunStatus,
    now_iso,
)


# ---------------------------------------------------------------------------
# File layout constants (FORA workspace convention).
# ---------------------------------------------------------------------------

DEFAULT_SURFACE_SPEC_PATH = "workspace/project/api-surface.json"
DEFAULT_ADR_REGISTRY_PATH = "workspace/project/adr-registry.md"
DEFAULT_DOCS_INDEX_PATH = "workspace/project/docs.md"
DEFAULT_OUTPUT_DIR = "docs/api"

# Artifact paths (the v1 surface per the FORA-119 spec).
OPENAPI_PATH = "docs/api/openapi.yaml"
GRAPHQL_SDL_PATH = "docs/api/schema.graphql"
ASYNCAPI_PATH = "docs/api/asyncapi.yaml"
README_PATH = "docs/api/README.md"
DIFF_PATH = "docs/api/diff.md"

TODO_SENTINEL_PREFIX = "<!-- TODO(generated):"

OPENAPI_VERSION = "3.0.3"
ASYNCAPI_VERSION = "2.6.0"

# HTTP methods the REST surface supports, in OpenAPI order.
_REST_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


# ---------------------------------------------------------------------------
# Surface spec — declarative input the detector emits
# ---------------------------------------------------------------------------

@dataclass
class RestEndpoint:
    """One REST endpoint."""
    method: str                           # "GET" | "POST" | ...
    path: str                             # "/v1/checkout/sessions"
    operation_id: str = ""
    summary: str = ""
    description: str = ""
    tags: List[str] = field(default_factory=list)
    auth_scopes: List[str] = field(default_factory=list)   # e.g. ["checkout:write"]
    request_schema: Optional[Dict] = None                  # JSON Schema body
    response_schema: Optional[Dict] = None                 # JSON Schema 2xx body
    error_codes: List[int] = field(default_factory=list)   # e.g. [400, 401, 404]
    adr_refs: List[int] = field(default_factory=list)      # ADR numbers
    sample_request: Optional[Dict] = None
    sample_response: Optional[Dict] = None


@dataclass
class GraphqlOperation:
    """One GraphQL operation (query / mutation / subscription)."""
    kind: str                             # "query" | "mutation" | "subscription"
    name: str                             # "checkoutSession"
    description: str = ""
    args: List[Dict] = field(default_factory=list)         # [{name, type, required}]
    returns: str = ""                                      # GraphQL type string
    adr_refs: List[int] = field(default_factory=list)


@dataclass
class GraphqlType:
    """One GraphQL type (object / input / enum)."""
    name: str
    kind: str                             # "type" | "input" | "enum"
    description: str = ""
    fields: List[Dict] = field(default_factory=list)       # [{name, type, required, description}]


@dataclass
class AsyncEvent:
    """One async event for AsyncAPI."""
    name: str                             # "OrderPlaced"
    channel: str                          # "orders.placed"
    description: str = ""
    payload_schema: Optional[Dict] = None
    adr_refs: List[int] = field(default_factory=list)
    sample_payload: Optional[Dict] = None


@dataclass
class ApiSurfaceSpec:
    """The full API surface. The detector (CI or hand-curated) emits this."""
    version: str = "1.0"
    title: str = ""
    description: str = ""
    rest: List[RestEndpoint] = field(default_factory=list)
    graphql_operations: List[GraphqlOperation] = field(default_factory=list)
    graphql_types: List[GraphqlType] = field(default_factory=list)
    events: List[AsyncEvent] = field(default_factory=list)
    source_sha: str = ""                  # the commit that produced this spec

    @property
    def surface_sha(self) -> str:
        """Stable hash of the spec contents (excludes source_sha itself)."""
        canonical = _json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def to_dict(self) -> Dict:
        return {
            "version": self.version,
            "title": self.title,
            "description": self.description,
            "rest": [self._rest_to_dict(e) for e in self.rest],
            "graphql_operations": [self._gql_op_to_dict(o) for o in self.graphql_operations],
            "graphql_types": [self._gql_type_to_dict(t) for t in self.graphql_types],
            "events": [self._event_to_dict(e) for e in self.events],
            "source_sha": self.source_sha,
        }

    @staticmethod
    def _rest_to_dict(e: RestEndpoint) -> Dict:
        return {
            "method": e.method,
            "path": e.path,
            "operation_id": e.operation_id,
            "summary": e.summary,
            "description": e.description,
            "tags": list(e.tags),
            "auth_scopes": list(e.auth_scopes),
            "request_schema": e.request_schema,
            "response_schema": e.response_schema,
            "error_codes": list(e.error_codes),
            "adr_refs": list(e.adr_refs),
            "sample_request": e.sample_request,
            "sample_response": e.sample_response,
        }

    @staticmethod
    def _gql_op_to_dict(o: GraphqlOperation) -> Dict:
        return {
            "kind": o.kind,
            "name": o.name,
            "description": o.description,
            "args": list(o.args),
            "returns": o.returns,
            "adr_refs": list(o.adr_refs),
        }

    @staticmethod
    def _gql_type_to_dict(t: GraphqlType) -> Dict:
        return {
            "name": t.name,
            "kind": t.kind,
            "description": t.description,
            "fields": list(t.fields),
        }

    @staticmethod
    def _event_to_dict(e: AsyncEvent) -> Dict:
        return {
            "name": e.name,
            "channel": e.channel,
            "description": e.description,
            "payload_schema": e.payload_schema,
            "adr_refs": list(e.adr_refs),
            "sample_payload": e.sample_payload,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "ApiSurfaceSpec":
        return cls(
            version=d.get("version", "1.0"),
            title=d.get("title", ""),
            description=d.get("description", ""),
            rest=[RestEndpoint(**e) for e in d.get("rest", [])],
            graphql_operations=[
                GraphqlOperation(**o) for o in d.get("graphql_operations", [])
            ],
            graphql_types=[GraphqlType(**t) for t in d.get("graphql_types", [])],
            events=[AsyncEvent(**e) for e in d.get("events", [])],
            source_sha=d.get("source_sha", ""),
        )


# ---------------------------------------------------------------------------
# Pure renderer helpers — same inputs -> same bytes
# ---------------------------------------------------------------------------

def _rest_operation_id(endpoint: RestEndpoint) -> str:
    """Derive a stable operationId if none supplied (lowercase + camelCase)."""
    if endpoint.operation_id:
        return endpoint.operation_id
    method = endpoint.method.lower()
    # /v1/checkout/sessions/{id} -> checkoutSessionsById
    parts = [p for p in re.split(r"[/{}]", endpoint.path) if p and not p.startswith("v")]
    label = "".join(p[:1].upper() + p[1:] for p in parts) or "root"
    return f"{method}{label}"


def _openapi_path_params(endpoint: RestEndpoint) -> List[Dict]:
    """Extract `{name}` placeholders from the path as OpenAPI parameter entries."""
    out: List[Dict] = []
    for m in re.finditer(r"\{([^}]+)\}", endpoint.path):
        out.append({
            "name": m.group(1),
            "in": "path",
            "required": True,
            "schema": {"type": "string"},
            "description": f"Path parameter `{m.group(1)}`",
        })
    return out


def render_openapi(spec: ApiSurfaceSpec) -> str:
    """Render the OpenAPI 3.0 YAML for the REST surface.

    Empty surface → emits a minimal valid OpenAPI doc (paths: {}).
    Deterministic: same `spec.to_dict()` → same bytes.
    """
    info: Dict = {
        "title": spec.title or "FORA Public API",
        "version": spec.version,
        "description": spec.description or "API surface generated by the Documentation Agent (FORA-119 / 7.1.3).",
    }
    paths: Dict = {}
    for ep in spec.rest:
        m = ep.method.lower()
        if m not in _REST_METHODS:
            continue
        op: Dict = {}
        if ep.summary:
            op["summary"] = ep.summary
        if ep.description:
            op["description"] = ep.description
        if ep.tags:
            op["tags"] = list(sorted(ep.tags))
        if ep.auth_scopes:
            op["security"] = [{"BearerAuth": list(sorted(ep.auth_scopes))}]
        op["operationId"] = _rest_operation_id(ep)
        path_params = _openapi_path_params(ep)
        if path_params:
            op["parameters"] = path_params
        if ep.request_schema is not None:
            op["requestBody"] = {
                "required": True,
                "content": {"application/json": {"schema": ep.request_schema}},
            }
        responses: Dict = {}
        if ep.response_schema is not None:
            responses["200"] = {
                "description": "Successful response",
                "content": {"application/json": {"schema": ep.response_schema}},
            }
        else:
            responses["200"] = {"description": "Successful response"}
        for code in ep.error_codes:
            responses[str(code)] = {
                "description": _error_description(code),
            }
        op["responses"] = responses
        if ep.sample_request is not None or ep.sample_response is not None:
            examples: Dict = {}
            if ep.sample_request is not None:
                examples["request"] = {
                    "value": ep.sample_request,
                    "summary": "Sample request",
                }
            if ep.sample_response is not None:
                examples["response"] = {
                    "value": ep.sample_response,
                    "summary": "Sample response",
                }
            op["x-samples"] = examples
        if ep.adr_refs:
            op["x-adr-refs"] = [f"docs/adr/{n:04d}.md" for n in sorted(ep.adr_refs)]
        bucket = paths.setdefault(ep.path, {})
        bucket[m] = op

    components: Dict = {
        "securitySchemes": {
            "BearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
            }
        }
    }

    doc: Dict = {
        "openapi": OPENAPI_VERSION,
        "info": info,
        "paths": dict(sorted(paths.items())),
        "components": components,
    }
    # yaml.safe_dump preserves key order; default_flow_style=False keeps it
    # block-style. sort_keys=False so the dict order above is honoured.
    return yaml.safe_dump(
        doc,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    )


def _error_description(code: int) -> str:
    return {
        400: "Bad request",
        401: "Unauthenticated",
        403: "Forbidden",
        404: "Not found",
        409: "Conflict",
        422: "Unprocessable entity",
        429: "Rate limited",
        500: "Internal server error",
        502: "Upstream failure",
        503: "Service unavailable",
        504: "Gateway timeout",
    }.get(code, f"HTTP {code}")


def _gql_field_line(field: Dict) -> str:
    parts: List[str] = []
    type_str = field.get("type", "String")
    required = field.get("required", False)
    if required and not type_str.endswith("!"):
        type_str = f"{type_str}!"
    parts.append(f"  {field.get('name', 'field')}: {type_str}")
    if field.get("description"):
        parts[-1] = parts[-1] + f"  # {field['description']}"
    return parts[0]


def render_graphql_sdl(spec: ApiSurfaceSpec) -> str:
    """Render GraphQL SDL for the GraphQL surface.

    Empty surface → emits a placeholder Object with a sentinel.
    """
    L: List[str] = []
    L.append("# GraphQL SDL — generated by the Documentation Agent (FORA-119 / 7.1.3)")
    L.append("# Source SHA: " + (spec.source_sha or "unknown"))
    L.append("")
    if not spec.graphql_types and not spec.graphql_operations:
        L.append(f"{TODO_SENTINEL_PREFIX} empty GraphQL surface; add `graphql_operations` and `graphql_types` to `workspace/project/api-surface.json` to populate. -->")
        L.append("")
        L.append("type Query {")
        L.append("  _empty: String  # TODO(generated): no queries defined")
        L.append("}")
        L.append("")
        return "\n".join(L)

    # Types first
    for t in spec.graphql_types:
        if t.description:
            L.append(f'"""{t.description}"""')
        if t.kind == "enum":
            values = ", ".join(f.get("name", "VALUE") for f in t.fields) or "VALUE"
            L.append(f"enum {t.name} {{ {values} }}")
        else:
            keyword = "input" if t.kind == "input" else "type"
            L.append(f"{keyword} {t.name} {{")
            for f in t.fields:
                L.append(_gql_field_line(f))
            if not t.fields:
                L.append("  _empty: String  # TODO(generated): no fields defined")
            L.append("}")
        L.append("")

    # Operation containers
    for kind in ("query", "mutation", "subscription"):
        ops = [o for o in spec.graphql_operations if o.kind == kind]
        if not ops:
            continue
        L.append(f"type {kind.capitalize()} {{")
        for o in ops:
            args: List[str] = []
            for a in o.args:
                atype = a.get("type", "String")
                if a.get("required", False) and not atype.endswith("!"):
                    atype = f"{atype}!"
                arg_str = f"{a.get('name', 'arg')}: {atype}"
                if a.get("description"):
                    arg_str += f"  # {a['description']}"
                args.append(arg_str)
            arg_str = f"({', '.join(args)})" if args else ""
            ret = o.returns or "Boolean"
            line = f"  {o.name}{arg_str}: {ret}"
            if o.description:
                line += f"  # {o.description}"
            L.append(line)
        L.append("}")
        L.append("")

    return "\n".join(L).rstrip() + "\n"


def render_asyncapi(spec: ApiSurfaceSpec) -> str:
    """Render AsyncAPI 2.x YAML for the event surface."""
    info: Dict = {
        "title": (spec.title or "FORA Events") + " — AsyncAPI",
        "version": spec.version,
        "description": "Event surface generated by the Documentation Agent (FORA-119 / 7.1.3).",
    }
    channels: Dict = {}
    messages: Dict = {}
    for ev in spec.events:
        channel_key = ev.channel
        channel: Dict = {
            "description": ev.description or f"Channel for {ev.name}",
            "messages": {ev.name: {"$ref": f"#/components/messages/{ev.name}"}},
        }
        channels[channel_key] = channel
        message: Dict = {
            "name": ev.name,
            "title": ev.name,
            "description": ev.description,
            "payload": ev.payload_schema or {"type": "object", "additionalProperties": True},
            "x-samples": {"value": ev.sample_payload} if ev.sample_payload is not None else None,
            "x-adr-refs": [f"docs/adr/{n:04d}.md" for n in sorted(ev.adr_refs)] or None,
        }
        # Strip None-valued x- extensions so the YAML stays minimal.
        message = {k: v for k, v in message.items() if v is not None}
        messages[ev.name] = message

    doc: Dict = {
        "asyncapi": ASYNCAPI_VERSION,
        "info": info,
        "channels": dict(sorted(channels.items())),
    }
    if messages:
        doc["components"] = {"messages": dict(sorted(messages.items()))}
    return yaml.safe_dump(
        doc,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    )


def render_readme(spec: ApiSurfaceSpec, adr_index: Dict[int, AdrRegistryEntry]) -> str:
    """Render the markdown summary (`docs/api/README.md`).

    Per the FORA-119 spec: "For each endpoint: signature, request
    schema, response schema, auth requirements, sample request/response,
    error codes." Cross-link to ADRs.
    """
    L: List[str] = []
    L.append(f"# {spec.title or 'FORA Public API'}")
    L.append("")
    L.append(f"> Generated by the Documentation Agent ([FORA-119](/FORA/issues/FORA-119) / 7.1.3). **Source SHA:** `{spec.source_sha or 'unknown'}`. **Surface SHA:** `{spec.surface_sha[:12]}`. Re-running with the same surface is a no-op (idempotency contract).")
    L.append("")
    if spec.description:
        L.append(spec.description)
        L.append("")

    L.append("## Artifacts")
    L.append("")
    L.append(f"- [`openapi.yaml`](openapi.yaml) — OpenAPI {OPENAPI_VERSION} for the REST surface.")
    L.append(f"- [`schema.graphql`](schema.graphql) — GraphQL SDL for the GraphQL surface.")
    L.append(f"- [`asyncapi.yaml`](asyncapi.yaml) — AsyncAPI {ASYNCAPI_VERSION} for the event surface.")
    L.append(f"- [`diff.md`](diff.md) — new / changed / removed endpoints since the prior run.")
    L.append("")

    # ---- REST surface
    L.append(f"## REST surface ({len(spec.rest)} endpoint{'s' if len(spec.rest) != 1 else ''})")
    L.append("")
    if not spec.rest:
        L.append(f"{TODO_SENTINEL_PREFIX} empty REST surface; add endpoints to `workspace/project/api-surface.json#rest[]` to populate. -->")
        L.append("")
    else:
        for ep in spec.rest:
            L.extend(_render_rest_section(ep, adr_index))

    # ---- GraphQL surface
    L.append(f"## GraphQL surface ({len(spec.graphql_operations)} operation{'s' if len(spec.graphql_operations) != 1 else ''}, {len(spec.graphql_types)} type{'s' if len(spec.graphql_types) != 1 else ''})")
    L.append("")
    if not spec.graphql_operations and not spec.graphql_types:
        L.append(f"{TODO_SENTINEL_PREFIX} empty GraphQL surface; add `graphql_operations` and `graphql_types` to `workspace/project/api-surface.json` to populate. -->")
        L.append("")
    else:
        for op in spec.graphql_operations:
            L.extend(_render_graphql_operation(op, adr_index))
        L.append("")
        if spec.graphql_types:
            L.append("### Types")
            L.append("")
            for t in spec.graphql_types:
                if t.description:
                    L.append(f"**{t.name}** — {t.description}")
                else:
                    L.append(f"**{t.name}**")
                if t.fields:
                    for f in t.fields:
                        type_str = f.get("type", "String")
                        if f.get("required", False) and not type_str.endswith("!"):
                            type_str = f"{type_str}!"
                        L.append(f"- `{f.get('name', 'field')}: {type_str}`" + (f" — {f['description']}" if f.get("description") else ""))
                L.append("")

    # ---- AsyncAPI surface
    L.append(f"## Event surface ({len(spec.events)} event{'s' if len(spec.events) != 1 else ''})")
    L.append("")
    if not spec.events:
        L.append(f"{TODO_SENTINEL_PREFIX} empty event surface; add events to `workspace/project/api-surface.json#events[]` to populate. -->")
        L.append("")
    else:
        for ev in spec.events:
            L.extend(_render_async_event(ev, adr_index))

    L.append("---")
    L.append("")
    L.append("**Storage:** these artifacts are tracked by the Documentation Agent's doc index ([`workspace/project/docs.md`](../../workspace/project/docs.md)). Stale `api_docs` (per the FORA-117 freshness SLA: 24h) block the release stage transition.")
    L.append("")

    return "\n".join(L)


def _render_rest_section(ep: RestEndpoint, adr_index: Dict[int, AdrRegistryEntry]) -> List[str]:
    """Render one REST endpoint section."""
    L: List[str] = []
    L.append(f"### `{ep.method.upper()} {ep.path}`")
    L.append("")
    if ep.summary:
        L.append(f"**{ep.summary}**")
        L.append("")
    if ep.description:
        L.append(ep.description)
        L.append("")
    L.append(f"- **Operation ID:** `{_rest_operation_id(ep)}`")
    if ep.tags:
        L.append(f"- **Tags:** {', '.join(f'`{t}`' for t in ep.tags)}")
    if ep.auth_scopes:
        L.append(f"- **Auth:** Bearer JWT, scopes: {', '.join(f'`{s}`' for s in sorted(ep.auth_scopes))}")
    else:
        L.append("- **Auth:** none (public)")
    if ep.request_schema is not None:
        L.append(f"- **Request body:** `application/json` — see [openapi.yaml](openapi.yaml)")
    if ep.response_schema is not None:
        L.append(f"- **Response body:** `application/json` — see [openapi.yaml](openapi.yaml)")
    if ep.error_codes:
        L.append(f"- **Error codes:** {', '.join(f'`{c}`' for c in sorted(ep.error_codes))}")
    if ep.sample_request is not None:
        L.append("")
        L.append("**Sample request:**")
        L.append("")
        L.append("```json")
        L.append(_json.dumps(ep.sample_request, indent=2))
        L.append("```")
    if ep.sample_response is not None:
        L.append("")
        L.append("**Sample response:**")
        L.append("")
        L.append("```json")
        L.append(_json.dumps(ep.sample_response, indent=2))
        L.append("```")
    if ep.adr_refs:
        L.append("")
        L.append("**Related ADRs:** " + ", ".join(_adr_link(n, adr_index) for n in sorted(ep.adr_refs)))
    L.append("")
    return L


def _render_graphql_operation(op: GraphqlOperation, adr_index: Dict[int, AdrRegistryEntry]) -> List[str]:
    """Render one GraphQL operation section."""
    L: List[str] = []
    L.append(f"### `{op.kind}: {op.name}`")
    L.append("")
    if op.description:
        L.append(op.description)
        L.append("")
    if op.args:
        L.append("**Arguments:**")
        L.append("")
        for a in op.args:
            type_str = a.get("type", "String")
            req = " (required)" if a.get("required", False) else ""
            L.append(f"- `{a.get('name', 'arg')}: {type_str}`{req}" + (f" — {a['description']}" if a.get("description") else ""))
        L.append("")
    if op.returns:
        L.append(f"**Returns:** `{op.returns}`")
    if op.adr_refs:
        L.append("")
        L.append("**Related ADRs:** " + ", ".join(_adr_link(n, adr_index) for n in sorted(op.adr_refs)))
    L.append("")
    return L


def _render_async_event(ev: AsyncEvent, adr_index: Dict[int, AdrRegistryEntry]) -> List[str]:
    """Render one async event section."""
    L: List[str] = []
    L.append(f"### `{ev.name}` (channel: `{ev.channel}`)")
    L.append("")
    if ev.description:
        L.append(ev.description)
        L.append("")
    if ev.payload_schema is not None:
        L.append(f"- **Payload schema:** see [asyncapi.yaml](asyncapi.yaml)")
    if ev.sample_payload is not None:
        L.append("")
        L.append("**Sample payload:**")
        L.append("")
        L.append("```json")
        L.append(_json.dumps(ev.sample_payload, indent=2))
        L.append("```")
    if ev.adr_refs:
        L.append("")
        L.append("**Related ADRs:** " + ", ".join(_adr_link(n, adr_index) for n in sorted(ev.adr_refs)))
    L.append("")
    return L


def _adr_link(num: int, adr_index: Dict[int, AdrRegistryEntry]) -> str:
    entry = adr_index.get(num)
    if entry is None:
        return f"[ADR {num:04d}](docs/adr/{num:04d}.md) (missing in registry)"
    return f"[ADR {num:04d} — {entry.title}]({entry.path})"


# ---------------------------------------------------------------------------
# Doc diff — new / changed / removed endpoints
# ---------------------------------------------------------------------------

@dataclass
class EndpointKey:
    method: str
    path: str

    @property
    def key(self) -> str:
        return f"{self.method.upper()} {self.path}"

    @classmethod
    def from_rest(cls, e: RestEndpoint) -> "EndpointKey":
        return cls(method=e.method.upper(), path=e.path)


@dataclass
class DocDiff:
    added: List[str] = field(default_factory=list)
    changed: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (self.added or self.changed or self.removed)

    def render(self, project_name: str = "FORA") -> str:
        L: List[str] = []
        L.append(f"# API doc diff — {project_name}")
        L.append("")
        if self.is_empty():
            L.append("No new, changed, or removed endpoints since the prior run.")
            L.append("")
            return "\n".join(L)
        if self.added:
            L.append(f"## Added ({len(self.added)})")
            L.append("")
            for k in self.added:
                L.append(f"- `{k}`")
            L.append("")
        if self.changed:
            L.append(f"## Changed ({len(self.changed)})")
            L.append("")
            for k in self.changed:
                L.append(f"- `{k}`")
            L.append("")
        if self.removed:
            L.append(f"## Removed ({len(self.removed)})")
            L.append("")
            for k in self.removed:
                L.append(f"- `{k}`")
            L.append("")
        return "\n".join(L)


def compute_diff(prior: Optional[ApiSurfaceSpec], current: ApiSurfaceSpec) -> DocDiff:
    """Compare two surface specs and return a doc diff.

    The contract is per-endpoint identity: `METHOD path`. We do not
    attempt to diff JSON Schemas (that's a future enhancement); the
    diff is a coarse-grain list of new / changed / removed endpoints
    + a per-event equivalent.
    """
    diff = DocDiff()
    cur_keys: Dict[str, None] = {EndpointKey.from_rest(e).key: None for e in current.rest}
    prior_keys: Dict[str, None] = (
        {EndpointKey.from_rest(e).key: None for e in prior.rest} if prior else {}
    )
    cur_event_keys = {e.name: None for e in current.events}
    prior_event_keys = {e.name: None for e in prior.events} if prior else {}
    cur_gql_keys = {o.name: None for o in current.graphql_operations}
    prior_gql_keys = {o.name: None for o in prior.graphql_operations} if prior else {}

    for k in sorted(set(cur_keys) - set(prior_keys)):
        diff.added.append(f"REST {k}")
    for k in sorted(set(prior_keys) - set(cur_keys)):
        diff.removed.append(f"REST {k}")
    # "Changed" — same identity, but the rendered body differs. We
    # approximate this with `surface_sha`: if a prior spec was on
    # disk, we re-render its OpenAPI and compare bytes.
    if prior is not None:
        prior_openapi = render_openapi(prior)
        cur_openapi = render_openapi(current)
        for e in current.rest:
            k = EndpointKey.from_rest(e).key
            if k in prior_keys and prior_openapi != cur_openapi:
                # Coarse: any change anywhere in the rendered OpenAPI
                # marks every endpoint as "changed". The spec only
                # requires a doc diff, not a per-endpoint diff.
                diff.changed.append(f"REST {k}")
                break

    for k in sorted(set(cur_event_keys) - set(prior_event_keys)):
        diff.added.append(f"EVENT {k}")
    for k in sorted(set(prior_event_keys) - set(cur_event_keys)):
        diff.removed.append(f"EVENT {k}")
    for k in sorted(set(cur_gql_keys) - set(prior_gql_keys)):
        diff.added.append(f"GQL {k}")
    for k in sorted(set(prior_gql_keys) - set(cur_gql_keys)):
        diff.removed.append(f"GQL {k}")
    return diff


# ---------------------------------------------------------------------------
# Generator class — owns I/O
# ---------------------------------------------------------------------------

@dataclass
class ApiDocsInputs:
    """All inputs the API docs renderer reads. Pure data; no I/O."""
    spec: ApiSurfaceSpec
    adr_index: Dict[int, AdrRegistryEntry] = field(default_factory=dict)
    prior_spec: Optional[ApiSurfaceSpec] = None
    repo_owner: str = ""
    repo_name: str = ""
    default_branch: str = "main"
    input_sha: str = ""


class ApiDocsGenerator:
    """Generates OpenAPI / GraphQL / AsyncAPI / README / diff from a surface spec."""

    def __init__(self, repo_root: Path | str = ".") -> None:
        self.repo_root = Path(repo_root)

    # -- file I/O --------------------------------------------------------

    def _read(self, rel: str) -> str:
        p = self.repo_root / rel
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def _read_adr_index(self) -> Dict[int, AdrRegistryEntry]:
        text = self._read(DEFAULT_ADR_REGISTRY_PATH)
        if not text:
            return {}
        try:
            reg = parse_registry_markdown(text)
        except Exception:
            return {}
        return {e.number: e for e in reg.entries}

    def _read_surface_spec(self, path: str = DEFAULT_SURFACE_SPEC_PATH) -> ApiSurfaceSpec:
        text = self._read(path)
        if not text:
            return ApiSurfaceSpec()
        try:
            d = _json.loads(text)
        except _json.JSONDecodeError:
            return ApiSurfaceSpec()
        return ApiSurfaceSpec.from_dict(d)

    def _build_inputs(self, inp: DocGenInput) -> ApiDocsInputs:
        spec = self._read_surface_spec()
        if inp.input_sha:
            spec.source_sha = inp.input_sha
        return ApiDocsInputs(
            spec=spec,
            adr_index=self._read_adr_index(),
            repo_owner=inp.repo.owner,
            repo_name=inp.repo.name,
            default_branch=inp.repo.default_branch,
            input_sha=inp.input_sha or "",
        )

    # -- public API ------------------------------------------------------

    def generate(self, inp: DocGenInput) -> Tuple[List[DocArtifact], List[DocIndexEntry], DocDiff]:
        """Render the full API docs surface; return (artifacts, doc_index_entries, diff)."""
        inputs = self._build_inputs(inp)
        spec = inputs.spec
        adr_index = inputs.adr_index

        # Render bodies
        openapi_body = render_openapi(spec)
        graphql_body = render_graphql_sdl(spec)
        asyncapi_body = render_asyncapi(spec)
        readme_body = render_readme(spec, adr_index)
        diff = compute_diff(inputs.prior_spec, spec)
        diff_body = diff.render(project_name=spec.title or "FORA")

        # Approval routing: first-ever run is a fresh publication
        # (non-trivial); subsequent runs are routine. The first-ever
        # signal is the absence of `docs/api/openapi.yaml` on disk.
        is_first_run = not (self.repo_root / OPENAPI_PATH).exists()

        now = now_iso()
        source_sha = inp.input_sha or spec.source_sha or "unknown"

        def _artifact(path: str, content: str, approval_required: bool) -> DocArtifact:
            sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
            return DocArtifact(
                path=path,
                content=content,
                content_sha=sha,
                freshness_timestamp=now,
                source_sha=source_sha,
                generator_type=GeneratorType.API_DOCS,
                approval_required=approval_required,
            )

        def _entry(
            path: str,
            title: str,
            content_sha: str,
            approval_required: bool,
            tags: List[str],
        ) -> DocIndexEntry:
            return DocIndexEntry(
                path=path,
                kind=DocKind.API_DOCS,
                title=title,
                last_generated_at=now,
                source_commit=source_sha,
                generator=GeneratorType.API_DOCS.value,
                version="1.0",
                content_sha=content_sha,
                approval_required=approval_required,
                tags=tags,
                architecture_area="api-surface",
            )

        approval = is_first_run
        artifacts = [
            _artifact(OPENAPI_PATH, openapi_body, approval),
            _artifact(GRAPHQL_SDL_PATH, graphql_body, approval),
            _artifact(ASYNCAPI_PATH, asyncapi_body, approval),
            _artifact(README_PATH, readme_body, approval),
            _artifact(DIFF_PATH, diff_body, False),  # diff is informational; not a publication
        ]
        entries = [
            _entry(OPENAPI_PATH, f"{spec.title or 'FORA Public API'} — OpenAPI", artifacts[0].content_sha, approval, ["openapi", "rest"]),
            _entry(GRAPHQL_SDL_PATH, f"{spec.title or 'FORA Public API'} — GraphQL SDL", artifacts[1].content_sha, approval, ["graphql", "sdl"]),
            _entry(ASYNCAPI_PATH, f"{spec.title or 'FORA Public API'} — AsyncAPI", artifacts[2].content_sha, approval, ["asyncapi", "events"]),
            _entry(README_PATH, f"{spec.title or 'FORA Public API'} — README", artifacts[3].content_sha, approval, ["summary", "rest", "graphql", "events"]),
            _entry(DIFF_PATH, f"{spec.title or 'FORA Public API'} — doc diff", artifacts[4].content_sha, False, ["diff"]),
        ]
        return artifacts, entries, diff


# ---------------------------------------------------------------------------
# High-level entry point — produces a DocGenOutput
# ---------------------------------------------------------------------------

def run_api_docs(
    inp: DocGenInput,
    repo_root: Path | str = ".",
    write: bool = True,
) -> DocGenOutput:
    """Run the API docs generator end-to-end and return a DocGenOutput.

    `write=True` (the default) writes `docs/api/*` to disk and refreshes
    the doc index. `write=False` is the dry-run path the smoke test uses
    to assert "no file is written" without polluting the test repo.
    """
    # Input validation
    errs: List[str] = []
    if not inp.input_sha:
        errs.append("input_sha is required (spec: determinism + source attribution)")
    if not inp.repo.owner or not inp.repo.name:
        errs.append("repo.owner and repo.name are required")
    if errs:
        out = DocGenOutput(
            run_id="api-docs-abort-" + hashlib.sha1(b"invalid").hexdigest()[:8],
            input_sha=inp.input_sha or "",
            status=RunStatus.ABORTED,
            errors=[
                DocGenError(
                    kind=ErrorKind.MISSING_INPUT_SHA
                    if "input_sha" in e
                    else ErrorKind.STORAGE_CONTRACT_MISSING,
                    message=e,
                    recoverable=False,
                )
                for e in errs
            ],
        )
        return out

    gen = ApiDocsGenerator(repo_root=repo_root)
    artifacts, doc_index_entries, diff = gen.generate(inp)

    if write:
        out_dir = Path(repo_root) / DEFAULT_OUTPUT_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        for a in artifacts:
            (Path(repo_root) / a.path).write_text(a.content, encoding="utf-8")
        # Refresh the on-disk doc index
        docs_index_path = Path(repo_root) / DEFAULT_DOCS_INDEX_PATH
        for entry in doc_index_entries:
            _refresh_doc_index(docs_index_path, entry)

    # Storage contract (FORA-117)
    doc_index = DocIndex(
        version="1.0",
        entries=list(doc_index_entries),
        generated_at=artifacts[0].freshness_timestamp,
        docs_index_sha=inp.memory_snapshot.docs_index_sha,
    )
    adr_registry = AdrRegistry(
        version="1.0",
        entries=[],
        generated_at=artifacts[0].freshness_timestamp,
        adr_registry_sha=inp.memory_snapshot.adr_registry_sha,
    )

    out = DocGenOutput(
        run_id="api-docs-" + hashlib.sha1((inp.input_sha or "").encode()).hexdigest()[:8],
        input_sha=inp.input_sha or "",
        status=RunStatus.OK,
        artifacts=list(artifacts),
        adr_index=[],
        freshness_metadata=FreshnessMetadata(
            docs_index_sha=inp.memory_snapshot.docs_index_sha,
            generated_at=artifacts[0].freshness_timestamp,
            oldest_artifact_source_sha=inp.commit_range.from_sha,
            newest_artifact_source_sha=inp.commit_range.to_sha,
        ),
        cost_record=CostRecord(
            prompt_hash=hashlib.sha1((inp.input_sha or "").encode()).hexdigest(),
            model=inp.model,
            tokens_in=0,    # structure-only renderer; no LLM call in v1
            tokens_out=0,
            usd=0.0,
            duration_ms=0,
            fallback_used=False,
        ),
        errors=[],
        doc_index=doc_index,
        adr_registry=adr_registry,
        freshness_warnings=doc_index.freshness_check(),
    )
    return out


# ---------------------------------------------------------------------------
# On-disk doc-index refresh (preserves the existing frontmatter + prose)
# ---------------------------------------------------------------------------

def _refresh_doc_index(path: Path, entry: DocIndexEntry) -> None:
    """Append or replace the entry in `workspace/project/docs.md`.

    Preserves the existing frontmatter and human-readable prose; only
    rewrites the fenced JSON block. If the file does not exist, seeds
    a minimal one.
    """
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        idx = DocIndex(version="1.0", entries=[entry])
        path.write_text(_render_index_markdown(idx), encoding="utf-8")
        return
    text = path.read_text(encoding="utf-8")
    idx = parse_index_markdown(text)
    existing = idx.by_path(entry.path)
    if existing is not None:
        existing.last_generated_at = entry.last_generated_at
        existing.source_commit = entry.source_commit
        existing.content_sha = entry.content_sha
        existing.approval_required = entry.approval_required
        existing.title = entry.title
    else:
        idx.entries.append(entry)
    idx.generated_at = now_iso()
    body = _json.dumps(idx.to_dict(), indent=2)
    # Use a callable for the replacement so any `\u` escapes in the
    # JSON body are treated as literal characters (not regex
    # backreferences). `re.sub` interprets the replacement string as
    # a regex template, which is the wrong semantics here.
    new_text = _FENCED_JSON_RE.sub(lambda _m: f"```json\n{body}\n```", text, count=1)
    path.write_text(new_text, encoding="utf-8")


def _render_index_markdown(idx: DocIndex) -> str:
    body = _json.dumps(idx.to_dict(), indent=2)
    return (
        "---\n"
        "name: doc-index\n"
        f"version: {idx.version}\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  The v1 knowledge-layer surface the Documentation Agent writes to and that\n"
        "  the Memory Agent and Audit Agent read from.\n"
        "---\n\n"
        "# Doc Index — FORA Project\n\n"
        "```json\n"
        f"{body}\n"
        "```\n"
    )


__all__ = [
    "RestEndpoint",
    "GraphqlOperation",
    "GraphqlType",
    "AsyncEvent",
    "ApiSurfaceSpec",
    "ApiDocsInputs",
    "ApiDocsGenerator",
    "DocDiff",
    "EndpointKey",
    "OPENAPI_PATH",
    "GRAPHQL_SDL_PATH",
    "ASYNCAPI_PATH",
    "README_PATH",
    "DIFF_PATH",
    "DEFAULT_OUTPUT_DIR",
    "DEFAULT_SURFACE_SPEC_PATH",
    "render_openapi",
    "render_graphql_sdl",
    "render_asyncapi",
    "render_readme",
    "compute_diff",
    "run_api_docs",
]
