/**
 * AuditCenter — Plan 1 §3.12 + Plan 2 §3.4 composer.
 *
 * The Audit Center ties the seven sub-surfaces together:
 *   1. Query builder (filter axes)
 *   2. Saved queries panel (per-user persistence)
 *   3. Investigation mode toggle (session-scoped forced-dark)
 *   4. Audit entry results table (TypedTable over AuditEntryRenderer rows)
 *   5. Audit Timeline Graph (the React Flow canvas)
 *   6. Audit entry panel (click entry → full view)
 *   7. Audit export button (v1.1 placeholder, disabled)
 *
 * Tenant scoping is enforced by the {@link TenantScopedAuditFetcher} wrapper
 * passed in by the consumer. The center does not own fetches; the parent
 * (the runtime consumer — e.g. the Forge dashboard) supplies a fetcher
 * already configured with the active tenant.
 *
 * The click-to-pin behavior (Plan 2 §3.4 "Click actor → that actor's audit
 * trail") is wired via the `pinnedFilter` state: a click on a node in the
 * timeline adds the actor/tenant to the current query.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { AuditEntryRenderer } from "../typed-artifacts/audit-entry";
import type { AuditEntry } from "../typed-artifacts/types";
import { TypedTable, type TypedTableColumn } from "../lists/typed-table";
import {
  AuditTimelineGraphCanvas,
  type AuditGraphProvider,
} from "../graph";
import { Button } from "../primitives/button";
import { cn } from "../tokens/cn";
import { applyAuditQuery } from "./apply-query";
import { AuditQueryBuilder } from "./audit-query-builder";
import { createSessionAuditQueryStore, type AuditQueryStore } from "./audit-query-store";
import { AuditExportButton } from "./audit-export-button";
import { InvestigationModeToggle } from "./investigation-mode-toggle";
import { SavedQueriesPanel, shareLink } from "./saved-queries-panel";
import type { AuditQuery, PinnedAuditFilter } from "./types";

export interface AuditCenterProps {
  readonly provider: AuditGraphProvider;
  readonly tenantScope: string;
  /** External query store. Defaults to sessionStorage-backed. */
  readonly store?: AuditQueryStore;
  /** Initial query; defaults to `{}`. */
  readonly initialQuery?: AuditQuery;
  /** Optional override for the canonical fixtures in tests. */
  readonly fetchEntries?: () => Promise<ReadonlyArray<AuditEntry>>;
  className?: string;
}

export function AuditCenter({
  provider,
  tenantScope,
  store,
  initialQuery = {},
  fetchEntries,
  className,
}: AuditCenterProps): JSX.Element {
  const queryStore = useMemo<AuditQueryStore>(
    () => store ?? createSessionAuditQueryStore(),
    [store],
  );
  const [query, setQuery] = useState<AuditQuery>(initialQuery);
  const [pinned, setPinned] = useState<PinnedAuditFilter | null>(null);
  const [entries, setEntries] = useState<ReadonlyArray<AuditEntry>>([]);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  // sessionStorage mutations don't fire React events; bump this when the
  // saved-queries panel mutates so the composer re-renders with the fresh list.
  const [savedRevision, setSavedRevision] = useState(0);

  // Force tenant scope to the locked tenant — the renderer is the
  // last-line defense, the fetcher is the primary.
  const effectiveQuery: AuditQuery = useMemo(
    () => ({ ...query, tenantId: tenantScope }),
    [query, tenantScope],
  );

  useEffect(() => {
    if (!fetchEntries) return;
    let cancelled = false;
    void fetchEntries().then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => { cancelled = true; };
  }, [fetchEntries]);

  const filtered = useMemo(
    () => applyAuditQuery(entries, effectiveQuery),
    [entries, effectiveQuery],
  );

  const onSelectNode = useCallback(
    (id: string | null) => {
      if (!id) return;
      // Find the node in the provider — actor/tenant clicks pin the filter.
      void provider.getNodes({}).then((nodes) => {
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        if (node.kind === "actor") {
          setPinned({ kind: "actor", id: node.id, label: node.label });
          setQuery((q) => ({ ...q, actorIds: Array.from(new Set([...(q.actorIds ?? []), node.id])) }));
        } else if (node.kind === "tenant") {
          setPinned({ kind: "tenant", id: node.id, label: node.label });
          setQuery((q) => ({ ...q, tenantId: node.id }));
        }
      });
    },
    [provider],
  );

  const onApplySaved = useCallback((q: AuditQuery) => {
    setQuery({ ...q, tenantId: tenantScope });
    setPinned(null);
  }, [tenantScope]);

  const onClearPinned = useCallback(() => {
    setPinned(null);
    setQuery((q) => {
      const next = { ...q };
      delete (next as { actorIds?: ReadonlyArray<string> }).actorIds;
      if (pinned?.kind === "tenant") delete (next as { tenantId?: string }).tenantId;
      return next;
    });
  }, [pinned]);

  const onShare = useCallback((url: string) => {
    setShareNotice(`Link copied: ${url}`);
    window.setTimeout(() => setShareNotice(null), 4_000);
  }, []);

  const columns = useMemo<ReadonlyArray<TypedTableColumn<AuditEntry>>>(
    () => [
      { id: "timestamp", header: "Time", numeric: false },
      { id: "tool", header: "Tool" },
      { id: "actor", header: "Actor",
        accessor: (row) => row.actor.displayName ?? row.actor.id },
      { id: "tenantId", header: "Tenant" },
      { id: "cost", header: "Cost",
        numeric: true,
        accessor: (row) => row.costUsd ?? 0 },
    ],
    [],
  );

  return (
    // The composer is rendered inside the app shell, which already provides
    // the page-level main landmark. We use a plain <div> with an aria-label
    // (region) for the Audit Center surface so axe-core's
    // landmark-main-is-top-level rule does not flag a nested <main>.
    <div
      role="region"
      aria-label="Audit Center"
      data-audit-center="v1"
      className={cn("grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]", className)}
    >
      <aside aria-label="Audit filters" className="space-y-3">
        <AuditQueryBuilder
          value={effectiveQuery}
          onChange={setQuery}
          pinned={pinned}
          tenantScope={tenantScope}
        />
        <div key={savedRevision} data-saved-queries-revision={savedRevision}>
          <SavedQueriesPanel
            store={queryStore}
            currentQuery={effectiveQuery}
            onApply={onApplySaved}
            onShareLink={onShare}
            onStoreChanged={() => setSavedRevision((r) => r + 1)}
          />
        </div>
      </aside>

      <section aria-label="Audit results" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-heading-2 font-semibold text-ink-default">Audit log</h2>
            <span
              className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-caption text-ink-muted"
              aria-live="polite"
              aria-label={`${filtered.length} entries match the current query`}
            >
              {filtered.length} entries
            </span>
            {pinned && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearPinned}
                aria-label={`Clear pinned ${pinned.kind} filter`}
              >
                Unpin {pinned.kind}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <InvestigationModeToggle />
            <AuditExportButton />
          </div>
        </div>

        {shareNotice && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-sm border border-surface-border bg-surface-raised px-2 py-1 text-caption text-ink-muted"
          >
            {shareNotice}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-surface-border bg-surface">
            <TypedTable<AuditEntry>
              data={filtered.map((f) => f.entry)}
              columns={columns}
              ariaLabel="Audit entries"
              initialPageSize={25}
            />
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-caption text-ink-muted">
                No audit entries match the current query.
              </p>
            )}
          </div>
          <aside aria-label="Audit Timeline Graph" className="h-[480px]">
            <AuditTimelineGraphCanvas
              provider={provider}
              onSelectNode={onSelectNode}
              withoutLiveRegion
            />
          </aside>
        </div>

        {selectedEntry && (
          <div className="rounded-md border border-surface-border bg-surface-raised p-3">
            <header className="mb-2 flex items-center justify-between">
              <h3 className="text-heading-3 font-semibold text-ink-default">Audit entry detail</h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedEntry(null)}
                aria-label="Close audit entry detail"
              >
                Close
              </Button>
            </header>
            <AuditEntryRenderer artifact={selectedEntry} variant="panel" />
          </div>
        )}
      </section>
    </div>
  );
}

// Re-export `shareLink` so consumers can build their own share UIs without
// reaching into the saved-queries-panel module.
export { shareLink };
