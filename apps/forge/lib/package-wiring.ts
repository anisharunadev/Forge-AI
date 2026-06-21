/**
 * v2.0 package-wiring index — client side mirror of
 * `backend/app/api/v1/_package_wiring.py`.
 *
 * Each retained `@forge-ai/*` package gets one row documenting:
 *   - npm name
 *   - wiring state (WIRED / READY / STUB / WIRED-STUB)
 *   - consumers (relative paths inside apps/forge)
 *   - notes (where the package plugs into the v2.0 surface)
 *
 * The canonical, authoritative copy lives in
 * `backend/app/api/v1/_package_wiring.py`. This file exists so the
 * client-side linter / docs generator can produce the same table
 * without re-walking every package directory.
 */

export type PackageWiringState =
  | 'WIRED'
  | 'READY'
  | 'STUB'
  | 'WIRED-STUB';

export interface PackageWiringRow {
  package: string;
  npmName: string | null;
  state: PackageWiringState;
  consumers: readonly string[];
  notes: string;
}

export const PACKAGE_WIRING: readonly PackageWiringRow[] = [
  {
    package: 'connector-events',
    npmName: 'the v2.0 connector-events package',
    state: 'READY',
    consumers: ['lib/connectors/audit-feed.ts', 'lib/connectors/audit-feed-types.ts'],
    notes:
      'TS only. Mirror of the FORA-484 hash-chained envelope + Tier-1 family ' +
      'catalogs. Consumed once the connector-events Node gateway lands.',
  },
  {
    package: 'contracts',
    npmName: null,
    state: 'READY',
    consumers: [],
    notes:
      'Pure JSON Schema (merge_block_rules.schema.json). No TS package.json. ' +
      'Audit-event join key, consumed by the audit service projection.',
  },
  {
    package: 'forge-ui',
    npmName: 'the v2.0 design system',
    state: 'WIRED',
    consumers: ['app/_demo/forge-ui/page.tsx'],
    notes:
      'Declared as a workspace dep in apps/forge/package.json. The demo ' +
      'route imports tokens / primitives / a11y / styles.css to exercise the ' +
      'full design-system surface.',
  },
  {
    package: 'gsd-core-stub',
    npmName: '@opengsd/gsd-core',
    state: 'WIRED-STUB',
    consumers: [],
    notes:
      'No direct client consumer. The backend (forge_commands.py / ' +
      'gsd_wrapper.py) mirrors the stub executeGsdCommand() interface. ' +
      'Replaced by the real @opengsd/gsd-core once published.',
  },
  {
    package: 'gsd-pi-stub',
    npmName: '@opengsd/gsd-pi',
    state: 'STUB',
    consumers: [],
    notes:
      'Re-exports gsd-core-stub. No client consumer yet; peripheral ' +
      'adapters will land when @opengsd/gsd-pi is published.',
  },
  {
    package: 'mcp-router',
    npmName: 'forge-ai/mcp-router',
    state: 'READY',
    consumers: ['lib/mcp-registry.ts'],
    notes:
      'lib/mcp-registry.ts mirrors the typed router port. The TS package is ' +
      'consumed by forge-ai/mcp-transport. A Node gateway will replace the ' +
      'in-process mirror.',
  },
  {
    package: 'mcp-schemas',
    npmName: 'forge-ai/mcp-schemas',
    state: 'READY',
    consumers: ['lib/mcp-registry.ts'],
    notes:
      'Schema registry. lib/mcp-registry.ts keeps the per-server ' +
      'config_schema in lock-step with the Python registry in ' +
      'backend/app/services/mcp_registry.py.',
  },
  {
    package: 'mcp-transport',
    npmName: 'forge-ai/mcp-transport',
    state: 'READY',
    consumers: [],
    notes:
      'TS only. stdio child-process transport with LRU pool. Replaces the ' +
      'in-process MCP shim once the Node gateway is live.',
  },
  {
    package: 'object-store',
    npmName: 'forge-ai/object-store',
    state: 'READY',
    consumers: [],
    notes:
      'S3 / GCS / SQS / OpenSearch adapter with tenant-prefix enforcement. ' +
      'Client surfaces presigned URLs through the backend; the TS adapter is ' +
      'the canonical reference.',
  },
  {
    package: 'oidc-clients',
    npmName: 'forge-ai/oidc-clients',
    state: 'READY',
    consumers: ['lib/auth.ts'],
    notes:
      'TS only. lib/auth.ts mirrors the Okta / Entra / Google config in ' +
      'backend/app/core/config.py and forwards bearer tokens to the API.',
  },
  {
    package: 'tenancy-lint',
    npmName: 'forge-ai/tenancy-lint',
    state: 'READY',
    consumers: [],
    notes:
      'CLI lint (SQL + TS) runs in CI. The client never bypasses RLS — all ' +
      'tenant context flows through lib/forge-api.ts x-forge-tenant-id.',
  },
];

export function byState(state: PackageWiringState): readonly PackageWiringRow[] {
  return PACKAGE_WIRING.filter((p) => p.state === state).slice().sort((a, b) =>
    a.package.localeCompare(b.package),
  );
}

export function allPackages(): readonly PackageWiringRow[] {
  return PACKAGE_WIRING.slice().sort((a, b) => a.package.localeCompare(b.package));
}