/**
 * AuditQueryBuilder — Plan 1 §3.12 query UI.
 *
 * Six axes: free-text, stages (multi-select), tools (multi-select),
 * actor kinds (multi-select), timestamp range (since/until), and a numeric
 * `cost_usd > X` filter. Pure controlled component: parent owns the query
 * state; this component is the UI + a11y wrapper. Use `useTypedForm` +
 * `TypedFormSection` + `TypedFormField` from the existing forms package.
 *
 * The form is intentionally debounce-free: the Audit Center re-applies the
 * query on every change. With 500 entries (the perf AC), `applyAuditQuery`
 * is O(n) and runs in under 1ms in jsdom; no debounce is needed at v1.0.
 */

import { useCallback, type ChangeEvent, type JSX } from "react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { TypedFormSection } from "../forms/typed-form-section";
import type { AuditActorKind } from "../typed-artifacts/types";
import type { AuditQuery } from "./types";

export const STAGES: ReadonlyArray<string> = [
  "ideation", "architect", "dev", "qa", "security", "devops", "docs",
];

export const TOOLS: ReadonlyArray<string> = [
  "ideation", "architect", "developer", "qa", "security", "devops", "documentation",
  "orchestrator", "cost", "audit", "memory",
];

export const ACTOR_KINDS: ReadonlyArray<AuditActorKind> = [
  "user", "agent", "system", "scheduler",
];

export interface AuditQueryBuilderProps {
  readonly value: AuditQuery;
  readonly onChange: (next: AuditQuery) => void;
  /** Optional pinned filter from clicking actor/tenant in the timeline. */
  readonly pinned?: { readonly kind: "actor" | "tenant"; readonly id: string } | null;
  /** Optional tenant id to lock the tenant axis. When null the tenant axis is editable. */
  readonly tenantScope?: string;
  className?: string;
}

export function AuditQueryBuilder({
  value,
  onChange,
  pinned,
  tenantScope,
  className,
}: AuditQueryBuilderProps): JSX.Element {
  const update = useCallback(
    (patch: AuditQueryPatch) => onChange(applyQueryPatch(value, patch)),
    [onChange, value],
  );

  const onText = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => update({ text: e.target.value || undefined }),
    [update],
  );
  const onSince = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => update({ since: e.target.value || undefined }),
    [update],
  );
  const onUntil = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => update({ until: e.target.value || undefined }),
    [update],
  );
  const onMinCost = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const n = Number.parseFloat(e.target.value);
      update({ minCostUsd: Number.isFinite(n) ? n : undefined });
    },
    [update],
  );
  const onStages = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const checked = e.target.checked;
      const stage = e.target.value;
      const current = value.stages ?? [];
      const next = checked ? [...current, stage] : current.filter((s) => s !== stage);
      update({ stages: next.length > 0 ? next : undefined });
    },
    [update, value.stages],
  );
  const onActorKinds = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const checked = e.target.checked;
      const kind = e.target.value as AuditActorKind;
      const current = value.actorKinds ?? [];
      const next = checked ? [...current, kind] : current.filter((k) => k !== kind);
      update({ actorKinds: next.length > 0 ? next : undefined });
    },
    [update, value.actorKinds],
  );
  const onTenant = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => update({ tenantId: e.target.value || undefined }),
    [update],
  );

  const isTenantLocked = tenantScope !== undefined && tenantScope.length > 0;

  return (
    <form
      aria-label="Audit log query builder"
      className={className}
      onSubmit={(e) => e.preventDefault()}
    >
      <TypedFormSection title="Text search" description="Free text across tool, hashes, actor, tenant.">
        <Label htmlFor="audit-text" className="text-caption text-ink-muted">Contains</Label>
        <Input
          id="audit-text"
          type="search"
          placeholder="tool, hash, actor, tenant…"
          value={value.text ?? ""}
          onChange={onText}
          aria-describedby="audit-text-help"
        />
        <p id="audit-text-help" className="text-caption text-ink-subtle">
          Case-insensitive substring match.
        </p>
      </TypedFormSection>

      <TypedFormSection title="Stages" description="Restrict to specific BMAD workflow stages." className="mt-3">
        <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <legend className="sr-only">Stages</legend>
          {STAGES.map((s) => {
            const checked = (value.stages ?? []).includes(s);
            return (
              <label key={s} className="flex items-center gap-1.5 text-body-sm text-ink-default">
                <input
                  type="checkbox"
                  value={s}
                  checked={checked}
                  onChange={onStages}
                  aria-label={`Filter stage ${s}`}
                />
                {s}
              </label>
            );
          })}
        </fieldset>
      </TypedFormSection>

      <TypedFormSection title="Actor kinds" description="Restrict to user, agent, system, or scheduler actions." className="mt-3">
        <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <legend className="sr-only">Actor kinds</legend>
          {ACTOR_KINDS.map((k) => {
            const checked = (value.actorKinds ?? []).includes(k);
            return (
              <label key={k} className="flex items-center gap-1.5 text-body-sm text-ink-default">
                <input
                  type="checkbox"
                  value={k}
                  checked={checked}
                  onChange={onActorKinds}
                  aria-label={`Filter actor kind ${k}`}
                />
                {k}
              </label>
            );
          })}
        </fieldset>
      </TypedFormSection>

      <TypedFormSection title="Time range" description="Inclusive start, exclusive end (ISO 8601)." className="mt-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="audit-since" className="text-caption text-ink-muted">Since</Label>
            <Input
              id="audit-since"
              type="datetime-local"
              value={toLocal(value.since)}
              onChange={onSince}
              aria-label="Since timestamp"
            />
          </div>
          <div>
            <Label htmlFor="audit-until" className="text-caption text-ink-muted">Until</Label>
            <Input
              id="audit-until"
              type="datetime-local"
              value={toLocal(value.until)}
              onChange={onUntil}
              aria-label="Until timestamp"
            />
          </div>
        </div>
      </TypedFormSection>

      <TypedFormSection title="Cost threshold" description="Show only entries with cost above this USD value." className="mt-3">
        <Label htmlFor="audit-min-cost" className="text-caption text-ink-muted">Min cost (USD)</Label>
        <Input
          id="audit-min-cost"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.0001"
          value={value.minCostUsd ?? ""}
          onChange={onMinCost}
          aria-label="Minimum cost in USD"
        />
      </TypedFormSection>

      <TypedFormSection title="Tenant" description="Lock to one tenant — no cross-tenant lookups." className="mt-3">
        <Label htmlFor="audit-tenant" className="text-caption text-ink-muted">Tenant ID</Label>
        <Input
          id="audit-tenant"
          type="text"
          value={tenantScope ?? value.tenantId ?? ""}
          onChange={onTenant}
          readOnly={isTenantLocked}
          aria-readonly={isTenantLocked || undefined}
          aria-describedby="audit-tenant-help"
          placeholder={isTenantLocked ? "" : "any tenant"}
        />
        <p id="audit-tenant-help" className="text-caption text-ink-subtle">
          {isTenantLocked
            ? "Tenant is locked to the active session."
            : "Leave blank to query within the active tenant scope."}
        </p>
      </TypedFormSection>

      {pinned && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-caption text-ink-muted"
        >
          Pinned to {pinned.kind}: <span className="font-mono text-ink-default">{pinned.id}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
          aria-label="Reset all audit query filters"
        >
          Reset filters
        </Button>
      </div>
    </form>
  );
}

/**
 * Convert ISO 8601 → `<input type="datetime-local">` format (`YYYY-MM-DDTHH:mm`).
 * Returns "" when the input is undefined or unparseable so the field starts empty.
 */
function toLocal(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  // Local time in ISO without seconds — the input element accepts only minute precision.
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Patch shape for the query builder. Every field is `T | undefined` — the
 * patch layer distinguishes "leave alone" (key absent) from "set to
 * undefined" (key present, value undefined). Under
 * `exactOptionalPropertyTypes`, `Partial<T>` rejects explicit `undefined`
 * assignments, so this is the dedicated bridge.
 */
export type AuditQueryPatch = {
  readonly [K in keyof AuditQuery]?: AuditQuery[K] | undefined;
};

export function applyQueryPatch(base: AuditQuery, patch: AuditQueryPatch): AuditQuery {
  const next: Record<string, unknown> = { ...base };
  for (const k of Object.keys(patch) as ReadonlyArray<keyof AuditQuery>) {
    const v = patch[k];
    if (v === undefined) delete next[k as string];
    else next[k as string] = v;
  }
  return next as AuditQuery;
}
