/**
 * ConnectorDetailPanel — typed-artifact detail panel for the
 * Connector Center detail page (FORA-579).
 *
 * Mirrors `McpConnectorRenderer` variant="detail-panel" from
 * `@fora/forge-ui/typed-artifacts` (shipped in FORA-577) and adds the
 * detail-page-only features the spec calls out:
 *
 *   * Header — display name + status pill + "Open in audit" link.
 *   * Health snapshot — last call, p50/p95, error rate, callCount24h,
 *     sparkline.
 *   * Scope grant — granted/denied chips + roleBinding link.
 *   * Credential envelope — secretRef, fingerprint, valueLen,
 *     lastRotatedAt, expiresAt. The raw value NEVER crosses the wire
 *     or the DOM (FORA-128 contract).
 *   * Rotation deadline callout — when `expiresAt` is within 14d of
 *     the as-of timestamp.
 *   * Last 100 audit entries — inline panel composing the
 *     `AuditEntry` typed artifact (Plan 4 §3.9). "See all in Audit
 *     Center" link.
 *   * Actions — "Rotate credential" button (the destructive action;
 *     FORA-580 wires the modal). Disabled-by-default in this PR so
 *     the page renders before the modal lands.
 *
 * The page is RBAC-gated upstream (`apps/forge/app/connector-center/[id]/page.tsx`);
 * this component assumes the persona is allowed.
 *
 * All ids and testids are stable for the smoke probe + axe tests.
 */

import Link from "next/link";
import type { McpConnector } from "@/lib/connectors/mock-data";
import { ConnectorStatusPill } from "@/components/ConnectorStatusPill";
import type { AuditEntry } from "@/lib/connectors/audit-feed-types";

/** Hard-coded as-of timestamp; matches the mock data source's NOW. */
const AS_OF_ISO = "2026-06-20T17:21:00Z";
const ROTATION_WINDOW_DAYS = 14;

export interface ConnectorDetailPanelProps {
  readonly connector: McpConnector;
  readonly auditEntries: ReadonlyArray<AuditEntry>;
}

/**
 * Rotation-deadline callout check. Returns true when the credential
 * expires within `ROTATION_WINDOW_DAYS` of the as-of timestamp, OR
 * when the credential is already expired. The page surfaces a
 * warning + "Rotate now" prompt in either case.
 */
export function isRotationDeadlineImminent(
  expiresAt: string | undefined,
  asOfIso: string = AS_OF_ISO,
): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt) - Date.parse(asOfIso);
  if (Number.isNaN(ms)) return false;
  return ms <= ROTATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function fmtPct(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n} ms`;
}

/**
 * Synthesize a deterministic 24-point latency trend for the sparkline.
 * The trend oscillates around the connector's p50 / p95 with mild noise
 * so the sparkline renders something visually meaningful. The live
 * source will replace this with real per-hour p50 over the last 24h.
 */
function latencyTrend(p50: number | undefined, p95: number | undefined): ReadonlyArray<number> {
  if (p50 === undefined || p95 === undefined) return [];
  const out: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    const wave = Math.sin((i / 24) * Math.PI * 2);
    const drift = (wave + 1) / 2; // 0..1
    out.push(Math.round(p50 + (p95 - p50) * drift * (0.6 + 0.4 * Math.sin(i))));
  }
  return out;
}

/**
 * Sparkline — pure SVG. Avoids Recharts so the page renders without
 * the chart bundle; matches Plan 4 §5 inline trend preview shape.
 */
function Sparkline({
  values,
  width = 120,
  height = 28,
  label,
}: {
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  label: string;
}) {
  if (values.length < 2) {
    return (
      <span
        className="font-mono text-xs text-forge-300"
        aria-label={`${label} — no trend data`}
        data-testid="connector-sparkline-empty"
      >
        —
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  const pct = first === 0 ? 0 : Math.round((delta / first) * 100);
  const trendLabel = `${label}, 24h, ${pct >= 0 ? "+" : ""}${pct}%`;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={trendLabel}
      data-testid="connector-sparkline"
      data-sparkline-points={values.length}
      data-sparkline-trend={pct >= 0 ? "up" : "down"}
      className="inline-block align-middle"
    >
      <polyline
        fill="none"
        stroke="rgb(16 185 129)" // emerald-500
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

const ACTOR_TONE: Record<AuditEntry["actor"]["kind"], string> = {
  user: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  agent: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  system: "border-forge-700 bg-forge-800 text-forge-200",
  scheduler: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  return (
    <li
      className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 border-b border-forge-800 px-3 py-2 text-xs"
      role="row"
      aria-label={`Audit entry ${entry.id}`}
      data-testid="connector-audit-row"
      data-audit-id={entry.id}
      data-audit-tool={entry.tool}
    >
      <span className="font-mono text-forge-300">{entry.timestamp}</span>
      <span
        className={
          "rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " +
          ACTOR_TONE[entry.actor.kind]
        }
        aria-label={`Actor kind: ${entry.actor.kind}`}
      >
        {entry.actor.kind}
      </span>
      <span className="truncate text-forge-100">
        <span className="font-mono">{entry.tool}</span>
        {entry.artifactRef && (
          <span className="ml-2 text-forge-300">
            → {entry.artifactRef.kind}:{entry.artifactRef.id}
          </span>
        )}
      </span>
      <span className="font-mono text-forge-300" aria-label="Latency">
        {entry.latencyMs !== undefined ? `${entry.latencyMs} ms` : "—"}
      </span>
      <span
        className="font-mono text-forge-300"
        aria-label="Cost"
        data-testid="connector-audit-row-cost"
      >
        {entry.costUsd !== undefined ? `$${entry.costUsd.toFixed(4)}` : "—"}
      </span>
    </li>
  );
}

export function ConnectorDetailPanel({ connector, auditEntries }: ConnectorDetailPanelProps) {
  const c = connector;
  const trend = latencyTrend(c.health.p50Ms, c.health.p95Ms);
  const imminent = isRotationDeadlineImminent(c.credential.expiresAt);

  return (
    <article
      aria-labelledby={`connector-${c.id}-title`}
      className="card space-y-6"
      data-testid="connector-detail"
      data-connector-id={c.id}
      data-connector-tier={c.tier}
      data-connector-status={c.status}
    >
      {/* Header */}
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-forge-300">
          Tier {c.tier} connector ·{" "}
          <span className="font-mono">{c.tenantId}</span>
        </p>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1
              id={`connector-${c.id}-title`}
              className="text-2xl font-semibold text-forge-50"
            >
              {c.displayName}
            </h1>
            <p className="font-mono text-xs text-forge-300">{c.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <ConnectorStatusPill status={c.status} />
            <Link
              href={`/audit-center?connectorId=${encodeURIComponent(c.id)}`}
              className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 text-xs font-medium text-forge-50 hover:border-forge-500"
              data-testid="connector-open-in-audit"
              aria-label={`Open ${c.displayName} audit log in Audit Center`}
            >
              Open in audit →
            </Link>
          </div>
        </div>
      </header>

      {/* Rotation deadline callout — only when expiresAt is within 14d */}
      {imminent && (
        <section
          role="alert"
          aria-labelledby="rotation-deadline-h"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          data-testid="rotation-deadline-callout"
          data-rotation-deadline={c.credential.expiresAt}
        >
          <h2
            id="rotation-deadline-h"
            className="text-sm font-semibold uppercase tracking-wide text-amber-200"
          >
            Rotation deadline approaching
          </h2>
          <p className="mt-1 text-amber-100">
            Credential <span className="font-mono">{c.credential.secretRef}</span> expires{" "}
            <span className="font-mono">{c.credential.expiresAt}</span> — within{" "}
            {ROTATION_WINDOW_DAYS} days of the as-of timestamp{" "}
            <span className="font-mono">{AS_OF_ISO}</span>. Rotate now to keep the
            connector within the secrets-mcp rotation policy.
          </p>
        </section>
      )}

      {/* Health snapshot */}
      <section aria-labelledby="health-h" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="health-h" className="text-sm font-semibold uppercase tracking-wider text-forge-300">
            Health snapshot
          </h2>
          <Sparkline values={trend} label={`${c.displayName} p50/p95 latency trend`} />
        </div>
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm"
          aria-label="Health metrics"
        >
          <dt className="text-forge-300">Last call</dt>
          <dd className="font-mono text-forge-100" data-testid="connector-last-call">
            {c.health.lastCallAt ?? "—"}
          </dd>
          <dt className="text-forge-300">p50</dt>
          <dd className="font-mono text-forge-100" data-testid="connector-p50">
            {fmtMs(c.health.p50Ms)}
          </dd>
          <dt className="text-forge-300">p95</dt>
          <dd className="font-mono text-forge-100" data-testid="connector-p95">
            {fmtMs(c.health.p95Ms)}
          </dd>
          <dt className="text-forge-300">Error rate (24h)</dt>
          <dd className="font-mono text-forge-100" data-testid="connector-error-rate">
            {fmtPct(c.health.errorRate)}
          </dd>
          <dt className="text-forge-300">Calls (24h)</dt>
          <dd className="font-mono text-forge-100" data-testid="connector-call-count">
            {c.health.callCount24h}
          </dd>
        </dl>
      </section>

      {/* Scope grant */}
      <section aria-labelledby="scope-h" className="space-y-2">
        <h2 id="scope-h" className="text-sm font-semibold uppercase tracking-wider text-forge-300">
          Scope grant
        </h2>
        <p className="text-xs text-forge-300">
          Role binding:{" "}
          <Link
            href={`/governance-center?role=${encodeURIComponent(c.scope.roleBinding)}`}
            className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-forge-50 hover:border-forge-500"
            data-testid="connector-role-binding"
            aria-label={`Open ${c.scope.roleBinding} role binding in Governance Center`}
          >
            {c.scope.roleBinding}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-forge-300">Granted:</span>
          {c.scope.grantedScopes.length === 0 ? (
            <span
              className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-forge-300"
              data-testid="scope-granted-empty"
            >
              none
            </span>
          ) : (
            c.scope.grantedScopes.map((s) => (
              <span
                key={`g-${s}`}
                className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-200"
                data-testid="scope-granted-chip"
                data-scope={s}
                aria-label={`Granted: ${s}`}
              >
                {s}
              </span>
            ))
          )}
        </div>
        {c.scope.deniedScopes && c.scope.deniedScopes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-forge-300">Denied:</span>
            {c.scope.deniedScopes.map((s) => (
              <span
                key={`d-${s}`}
                className="rounded-sm border border-forge-700 bg-forge-900 px-2 py-0.5 font-mono text-forge-300"
                data-testid="scope-denied-chip"
                data-scope={s}
                aria-label={`Denied: ${s}`}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Credential envelope — redacted per FORA-128 */}
      <section aria-labelledby="cred-h" className="space-y-2">
        <h2 id="cred-h" className="text-sm font-semibold uppercase tracking-wider text-forge-300">
          Credential envelope
        </h2>
        <p className="text-xs text-forge-300">
          <span
            className="font-semibold uppercase tracking-wide text-emerald-300"
            aria-label="Redacted"
            data-testid="credential-redacted"
            data-redacted="true"
          >
            Redacted
          </span>{" "}
          per FORA-128 — raw values never cross the wire.
        </p>
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm"
          aria-label="Credential metadata"
        >
          <dt className="text-forge-300">Secret ref</dt>
          <dd className="font-mono text-forge-100" data-testid="credential-secret-ref">
            {c.credential.secretRef}
          </dd>
          <dt className="text-forge-300">Fingerprint</dt>
          <dd className="font-mono text-forge-100" data-testid="credential-fingerprint">
            {c.credential.fingerprint}
          </dd>
          {c.credential.valueLen !== undefined && (
            <>
              <dt className="text-forge-300">Value length</dt>
              <dd
                className="font-mono text-forge-100"
                data-testid="credential-value-len"
              >
                {c.credential.valueLen} bytes
              </dd>
            </>
          )}
          {c.credential.lastRotatedAt && (
            <>
              <dt className="text-forge-300">Last rotated</dt>
              <dd
                className="font-mono text-forge-100"
                data-testid="credential-last-rotated"
              >
                {c.credential.lastRotatedAt}
              </dd>
            </>
          )}
          {c.credential.expiresAt && (
            <>
              <dt className="text-forge-300">Expires at</dt>
              <dd
                className="font-mono text-forge-100"
                data-testid="credential-expires-at"
              >
                {c.credential.expiresAt}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Last 100 audit entries (inline panel). */}
      <section aria-labelledby="audit-h" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="audit-h" className="text-sm font-semibold uppercase tracking-wider text-forge-300">
            Last {auditEntries.length} audit entries
          </h2>
          <Link
            href={`/audit-center?connectorId=${encodeURIComponent(c.id)}`}
            className="text-xs text-forge-300 underline-offset-2 hover:underline"
            data-testid="connector-see-all-audit"
            aria-label={`See all audit entries for ${c.displayName} in Audit Center`}
          >
            See all in Audit Center →
          </Link>
        </div>
        {auditEntries.length === 0 ? (
          <p
            className="rounded-md border border-forge-700 bg-forge-800 p-3 text-xs text-forge-300"
            data-testid="connector-audit-empty"
          >
            No audit entries recorded for this connector in the last 24h.
          </p>
        ) : (
          <ul
            className="overflow-hidden rounded-md border border-forge-800"
            role="list"
            aria-label={`Last ${auditEntries.length} audit entries for ${c.displayName}`}
            data-testid="connector-audit-list"
          >
            {auditEntries.map((e) => (
              <AuditEntryRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </section>

      {/* Actions — Rotate credential (destructive; FORA-580 wires the modal). */}
      <footer
        className="flex items-center justify-between gap-3 border-t border-forge-800 pt-4"
        data-testid="connector-actions"
      >
        <Link
          href="/connector-center"
          className="text-xs text-forge-300 underline-offset-2 hover:underline"
          data-testid="connector-back-to-list"
        >
          ← Back to Connector Center
        </Link>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Wired by FORA-580 (rotate-credential destructive modal)"
          className="cursor-not-allowed rounded-sm border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-rose-300"
          data-testid="connector-rotate-credential"
        >
          Rotate credential
        </button>
      </footer>
    </article>
  );
}