/**
 * FORA-579 — typed mock audit-feed source for the Connector Center
 * detail panel.
 *
 * The detail panel surfaces the last 100 audit entries for a connector
 * inline (Plan 1 §3.2 / Plan 4 §3.9). The shape mirrors the
 * `AuditEntry` typed artifact from `the v2.0 typed-artifact system`
 * (shipped in FORA-505, package v0.5.0). The audit center's
 * `TenantScopedAuditFetcher` is the live source; this mock is the
 * dev-time seam the page reads from until that service is wired to
 * the forge console.
 *
 * Why mock: the audit-forwarder (FORA-204) emits per-tool-call events
 * to the connector-events stream; the orchestrator subscribes and the
 * connector-config service exposes the projection. The forge console
 * has not yet been wired to that projection — the seam here is the
 * one-file change that swaps in the live fetcher.
 *
 * The feed is keyed by `connectorId` so the per-connector detail
 * panel can fetch a deterministic batch without hitting the global
 * audit log. Each entry's `tool` is prefixed with the connector id
 * (e.g. `jira.search`, `github.create_issue`) so the audit center's
 * filter on connector id matches.
 */

import type { AuditEntry } from "./audit-feed-types";

const NOW = "2026-06-20T17:21:00Z";
const TENANT = process.env.FORA_SEED_TENANT_ID ?? "acme-corp";

/** The shape returned by the live audit-fetch seam (FORA-505 §TenantScopedAuditFetcher). */
export interface ConnectorAuditFeed {
  readonly connectorId: string;
  readonly entries: ReadonlyArray<AuditEntry>;
  readonly total: number;
}

/**
 * Generate the last N audit entries for a connector, ordered most-recent-first.
 * The `count` is bounded to 100 by the page contract (last 100 inline panel);
 * the caller passes whatever value it wants (the page passes 100).
 */
export async function getConnectorAuditFeed(
  _tenantId: string,
  connectorId: string,
  count: number = 100,
): Promise<ConnectorAuditFeed> {
  const bounded = Math.max(0, Math.min(count, 100));
  const entries: AuditEntry[] = [];
  for (let i = 0; i < bounded; i += 1) {
    entries.push(synthEntry(connectorId, i));
  }
  return { connectorId, entries, total: bounded };
}

/**
 * Synthesize a deterministic audit entry for a connector at offset `i`
 * (i=0 is most recent). Cycles through four operation kinds so the
 * feed shows variety in the inline panel.
 */
function synthEntry(connectorId: string, i: number): AuditEntry {
  const ops = [
    { tool: `${connectorId}.read`, queryHash: makeHash(connectorId, i, "q"), responseHash: makeHash(connectorId, i, "r"), latencyMs: 90 + (i % 30), tokens: { prompt: 240, completion: 60 } },
    { tool: `${connectorId}.search`, queryHash: makeHash(connectorId, i, "q"), responseHash: makeHash(connectorId, i, "r"), latencyMs: 130 + (i % 50), tokens: { prompt: 360, completion: 80 } },
    { tool: `${connectorId}.create_issue`, queryHash: makeHash(connectorId, i, "q"), responseHash: makeHash(connectorId, i, "r"), latencyMs: 220 + (i % 80), tokens: { prompt: 480, completion: 120 } },
    { tool: `${connectorId}.update`, queryHash: makeHash(connectorId, i, "q"), responseHash: makeHash(connectorId, i, "r"), latencyMs: 180 + (i % 70), tokens: { prompt: 320, completion: 90 } },
  ] as const;
  const op = ops[i % ops.length]!;
  // Deterministic timestamp offset (10 minutes back per i) — the panel
  // renders "Apr 19 14:00" style. The mock is the seed; the live source
  // returns real timestamps.
  const offsetMs = i * 10 * 60 * 1000;
  return {
    id: `audit-${connectorId}-${i}`,
    timestamp: shiftMinutes(NOW, -offsetMs / 60000),
    actor: i % 5 === 0
      ? { kind: "scheduler", id: "scheduler:nightly-sweep", displayName: "Nightly sweep" }
      : { kind: "agent", id: "agent:SeniorEngineer", displayName: "Senior Engineer" },
    tenantId: TENANT,
    tool: op.tool,
    queryHash: op.queryHash,
    responseHash: op.responseHash,
    latencyMs: op.latencyMs,
    tokens: op.tokens,
    costUsd: round2(((op.latencyMs ?? 0) / 1000) * 0.002),
    artifactRef: i % 3 === 0
      ? { kind: "task", id: `task-${connectorId}-${i}` }
      : undefined,
  };
}

function makeHash(connectorId: string, i: number, salt: "q" | "r"): string {
  // Deterministic 12-char hex suffix — mirrors the live AuditEntry's
  // queryHash / responseHash shape. No real hash needed for mock data.
  const base = `${connectorId}-${salt}-${i}`;
  let h = 0;
  for (let j = 0; j < base.length; j += 1) h = ((h << 5) - h + base.charCodeAt(j)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `sha256:${hex}${hex.slice(0, 4)}`;
}

function shiftMinutes(iso: string, deltaMinutes: number): string {
  // Pure-string date math keeps the mock deterministic — no Date.now() drift.
  const ms = Date.parse(iso) + deltaMinutes * 60_000;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Keep NOW referenced so the constant isn't stripped during a future
// refactor; it's the data source's "as-of" timestamp.
export const __MOCK_AS_OF__ = NOW;