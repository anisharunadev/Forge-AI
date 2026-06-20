/**
 * DevelopmentFilters — Plan 1 §3.7 acceptance criterion #8.
 *
 * Filter by ADR status, by owner, by package, by "no tests" toggle, and
 * by free-text search. Pure UI; the composer owns the filter state and
 * passes the result to the panels.
 *
 * The component renders the four axes as a horizontal toolbar of selects
 * + an input, then a "Reset" button. Every axis is independent; an empty
 * value is "no filter on this axis" (matches the audit query pattern).
 */

import { useCallback, type JSX } from "react";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { cn } from "../tokens/cn";
import type { AdrRegistryEntry, DevelopmentFilter } from "./development";

const ADR_STATUSES: ReadonlyArray<AdrRegistryEntry["status"]> = [
  "proposed",
  "accepted",
  "superseded",
  "deprecated",
];

export interface DevelopmentFiltersProps {
  readonly value: DevelopmentFilter;
  readonly owners: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  readonly packages: ReadonlyArray<{ readonly name: string; readonly version: string }>;
  readonly onChange: (next: DevelopmentFilter) => void;
  readonly onReset: () => void;
  readonly className?: string;
}

export function DevelopmentFilters({
  value,
  owners,
  packages,
  onChange,
  onReset,
  className,
}: DevelopmentFiltersProps): JSX.Element {
  const setStatuses = useCallback(
    (next: ReadonlyArray<AdrRegistryEntry["status"]>) => {
      onChange({
        ...value,
        ...(next.length > 0 ? { adrStatuses: next } : {}),
      });
    },
    [value, onChange],
  );
  const setOwners = useCallback(
    (next: ReadonlyArray<string>) => {
      onChange({
        ...value,
        ...(next.length > 0 ? { ownerIds: next } : {}),
      });
    },
    [value, onChange],
  );
  const setPackages = useCallback(
    (next: ReadonlyArray<string>) => {
      onChange({
        ...value,
        ...(next.length > 0 ? { packageNames: next } : {}),
      });
    },
    [value, onChange],
  );
  const setNoTests = useCallback(
    (next: boolean) => {
      onChange({
        ...value,
        ...(next ? { noTestsOnly: true } : {}),
      });
    },
    [value, onChange],
  );
  const setText = useCallback(
    (next: string) => {
      onChange({
        ...value,
        ...(next.length > 0 ? { text: next } : {}),
      });
    },
    [value, onChange],
  );

  const activeCount =
    (value.adrStatuses?.length ?? 0) +
    (value.ownerIds?.length ?? 0) +
    (value.packageNames?.length ?? 0) +
    (value.noTestsOnly ? 1 : 0) +
    (value.text && value.text.length > 0 ? 1 : 0);

  return (
    <div
      role="toolbar"
      aria-label="Development Center filters"
      data-testid="development-filters"
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-md border border-surface-border bg-surface-raised p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="dev-filter-text" className="text-caption uppercase tracking-wider text-ink-muted">
          Search
        </Label>
        <Input
          id="dev-filter-text"
          type="search"
          placeholder="ADR / Patch / PR text"
          value={value.text ?? ""}
          onChange={(e) => setText(e.target.value)}
          data-testid="dev-filter-text"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-caption uppercase tracking-wider text-ink-muted">
          ADR status
        </Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="ADR status">
          {ADR_STATUSES.map((s) => {
            const active = (value.adrStatuses ?? []).includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const next = active
                    ? (value.adrStatuses ?? []).filter((x) => x !== s)
                    : [...(value.adrStatuses ?? []), s];
                  setStatuses(next);
                }}
                data-testid={`dev-filter-adr-${s}`}
                className={cn(
                  "rounded-sm border px-2 py-1 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  active
                    ? "border-brand-primary bg-brand-primary/10 text-ink-default"
                    : "border-surface-border bg-surface text-ink-muted hover:bg-surface-sunken",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dev-filter-owner" className="text-caption uppercase tracking-wider text-ink-muted">
          Owner
        </Label>
        <select
          id="dev-filter-owner"
          multiple
          size={1}
          value={value.ownerIds ?? []}
          onChange={(e) => setOwners(Array.from(e.target.selectedOptions).map((o) => o.value))}
          data-testid="dev-filter-owner"
          className="rounded-sm border border-surface-border bg-surface px-2 py-1 text-body-sm text-ink-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dev-filter-package" className="text-caption uppercase tracking-wider text-ink-muted">
          Package
        </Label>
        <select
          id="dev-filter-package"
          multiple
          size={1}
          value={value.packageNames ?? []}
          onChange={(e) => setPackages(Array.from(e.target.selectedOptions).map((o) => o.value))}
          data-testid="dev-filter-package"
          className="rounded-sm border border-surface-border bg-surface px-2 py-1 text-body-sm text-ink-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {packages.map((p) => (
            <option key={`${p.name}@${p.version}`} value={p.name}>
              {p.name}@{p.version}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-body-sm text-ink-default">
        <input
          type="checkbox"
          checked={value.noTestsOnly === true}
          onChange={(e) => setNoTests(e.target.checked)}
          data-testid="dev-filter-no-tests"
          className="rounded-sm border-surface-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        No tests only
      </label>

      <div className="ml-auto flex items-center gap-2">
        {activeCount > 0 && <Badge tone="primary">{activeCount} active</Badge>}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={activeCount === 0}
          data-testid="dev-filter-reset"
          aria-label="Reset filters"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

/** Apply DevelopmentFilter to a list of ADRs. Pure. */
export function applyAdrFilter(
  adrs: ReadonlyArray<AdrRegistryEntry>,
  filter: DevelopmentFilter,
): ReadonlyArray<AdrRegistryEntry> {
  const statuses = filter.adrStatuses ?? null;
  const text = filter.text?.trim().toLowerCase() ?? null;
  return adrs.filter((a) => {
    if (statuses !== null && !statuses.includes(a.status)) return false;
    if (text !== null && !`${a.title} ${a.architectureArea}`.toLowerCase().includes(text)) {
      return false;
    }
    return true;
  });
}
