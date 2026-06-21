"""v2.0 platform package wiring.

This module is the single seam that documents and re-exports the
backend-facing pieces of every retained package so the rest of the
FastAPI surface can `from app.api.v1._package_wiring import ...` and
stay decoupled from the package layout itself.

Per the v2.0 audit (2026-06-21), the retained packages fall into four
buckets:

* **WIRED** — code is already imported / used by the platform.
* **READY (TS only)** — TypeScript package, no Python bridge yet.
  Documented here; consumers wait for a future Node gateway.
* **STUB** — only a placeholder exists (gsd-core-stub, gsd-pi-stub).
* **WIRED-STUB** — backend already imports the stub at runtime
  (forge_commands.py / gsd_wrapper.py).

The package name → status table mirrors `packages/README.md`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PackageWiringStatus:
    """One row of the v2.0 package-wiring index."""

    package: str
    npm_name: str
    state: str  # WIRED | READY | STUB | WIRED-STUB
    consumers: tuple[str, ...]
    notes: str


# ---------------------------------------------------------------------------
# v2.0 package index
# ---------------------------------------------------------------------------
# Consumers are paths that already import from (or document an import from)
# the package. Paths are repo-relative. "TS-only" means no Python consumer
# is wired today — those packages will land behind a Node gateway later.
PACKAGE_WIRING: tuple[PackageWiringStatus, ...] = (
    PackageWiringStatus(
        package="connector-events",
        npm_name="the v2.0 connector-events package",
        state="READY",
        consumers=(),
        notes=(
            "TS only. Tier-1 connector event taxonomy + hash-chained store. "
            "Backend will subscribe via a Node gateway; Python "
            "(event_bus.py / connector_states.py) carries the same enum "
            "surface today."
        ),
    ),
    PackageWiringStatus(
        package="contracts",
        npm_name=None,
        state="READY",
        consumers=(),
        notes=(
            "Pure JSON Schema (merge_block_rules.schema.json). No npm / "
            "PyPI package.json. Consumed by the audit-event join key in "
            "backend/app/services/audit_service.py once a downstream "
            "consumer is added."
        ),
    ),
    PackageWiringStatus(
        package="forge-ui",
        npm_name="the v2.0 design system",
        state="WIRED",
        consumers=("apps/forge/app/_demo/forge-ui/page.tsx",),
        notes=(
            "Listed as workspace dep in apps/forge/package.json. The "
            "demo route imports primitives / tokens / a11y / styles.css "
            "to exercise the full design-system surface."
        ),
    ),
    PackageWiringStatus(
        package="gsd-core-stub",
        npm_name="@opengsd/gsd-core",
        state="WIRED-STUB",
        consumers=(
            "backend/app/agents/tools/gsd_wrapper.py",
            "backend/app/services/forge_commands.py",
            "packages/gsd-pi-stub/src/index.ts",
        ),
        notes=(
            "Backend mirrors the stub's executeGsdCommand() interface "
            "inline (gsd_wrapper.py lines 249–303). gsd-pi-stub re-exports "
            "this surface until the real @opengsd/gsd-core is published."
        ),
    ),
    PackageWiringStatus(
        package="gsd-pi-stub",
        npm_name="@opengsd/gsd-pi",
        state="STUB",
        consumers=(),
        notes=(
            "Re-exports gsd-core-stub. No direct backend consumer yet; "
            "the peripheral-integration adapters will be wired when the "
            "real @opengsd/gsd-pi ships."
        ),
    ),
    PackageWiringStatus(
        package="mcp-router",
        npm_name="the v2.0 MCP router package",
        state="READY",
        consumers=(
            "packages/mcp-transport/package.json",
            "backend/app/agents/tools/mcp_client.py",
        ),
        notes=(
            "mcp_client.py mirrors the typed router port in-process. The "
            "TS package is consumed by mcp-transport. A future Node "
            "gateway will replace the in-process mirror."
        ),
    ),
    PackageWiringStatus(
        package="mcp-schemas",
        npm_name="the v2.0 MCP schemas package",
        state="READY",
        consumers=("backend/app/services/mcp_registry.py",),
        notes=(
            "Schema registry mirrors the Python config_schema fragments "
            "in mcp_registry.py. The TS package is the canonical store; "
            "a CI check keeps the two in sync."
        ),
    ),
    PackageWiringStatus(
        package="mcp-transport",
        npm_name="the v2.0 MCP transport package",
        state="READY",
        consumers=("packages/mcp-transport/package.json",),
        notes=(
            "TS only. stdio child-process transport with LRU pool. "
            "Replaces the in-process MCP shim once the Node gateway is "
            "live."
        ),
    ),
    PackageWiringStatus(
        package="object-store",
        npm_name="the v2.0 object-store package",
        state="READY",
        consumers=("backend/app/services/terminal/exporter.py",),
        notes=(
            "S3 / GCS / SQS / OpenSearch adapter. The Python exporter "
            "(terminal/exporter.py) calls boto3 directly today; the "
            "tenancy-safety guarantees in the TS adapter are replicated "
            "via `tenants/{tenant_id}/...` prefix checks in "
            "backend/app/services/."
        ),
    ),
    PackageWiringStatus(
        package="oidc-clients",
        npm_name="the v2.0 OIDC clients package",
        state="READY",
        consumers=("backend/app/core/security.py",),
        notes=(
            "TS only. Backend uses python-jose directly today "
            "(security.py). The JWKS cache / Okta + Entra + Google "
            "config maps to settings in backend/app/core/config.py."
        ),
    ),
    PackageWiringStatus(
        package="tenancy-lint",
        npm_name="the v2.0 tenancy-lint package",
        state="READY",
        consumers=("backend/app/db/rls.py",),
        notes=(
            "CLI lint (SQL + TS) run in CI. Mirrors the runtime RLS "
            "context set in backend/app/db/rls.py — both enforce the "
            "tenants/{tenant_id}/... prefix and the BYPASSRLS allow-list."
        ),
    ),
)


def by_state(state: str) -> tuple[PackageWiringStatus, ...]:
    """Return all packages in the given state, sorted by package name."""
    return tuple(sorted((p for p in PACKAGE_WIRING if p.state == state), key=lambda p: p.package))


def all_packages() -> tuple[PackageWiringStatus, ...]:
    """Return every entry sorted by package name."""
    return tuple(sorted(PACKAGE_WIRING, key=lambda p: p.package))


__all__ = [
    "PackageWiringStatus",
    "PACKAGE_WIRING",
    "by_state",
    "all_packages",
]