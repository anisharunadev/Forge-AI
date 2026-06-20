/**
 * SavedQueriesPanel — Plan 1 §3.12 saved-query UI.
 *
 * Lists saved queries from the {@link AuditQueryStore}, lets the user pin
 * (apply), label, share-link (copy URL fragment), and delete. The v1.0 share
 * link encodes the query JSON in `location.hash` so the Audit Center can
 * deep-link to a saved view without a server round-trip. Server-side share
 * links are v1.1 (FORA-399 audit spine).
 */

import { useCallback, type JSX } from "react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { cn } from "../tokens/cn";
import type { AuditQueryStore } from "./audit-query-store";
import type { AuditQuery, SavedAuditQuery } from "./types";

export interface SavedQueriesPanelProps {
  readonly store: AuditQueryStore;
  readonly currentQuery: AuditQuery;
  readonly onApply: (query: AuditQuery) => void;
  readonly onShareLink?: (url: string) => void;
  /** Fires after every store mutation (save / remove) so the parent can refresh. */
  readonly onStoreChanged?: () => void;
  className?: string;
}

export function SavedQueriesPanel({
  store,
  currentQuery,
  onApply,
  onShareLink,
  onStoreChanged,
  className,
}: SavedQueriesPanelProps): JSX.Element {
  const list: ReadonlyArray<SavedAuditQuery> = store.list();

  const onSave = useCallback(() => {
    const id = makeId();
    const label = `Query ${new Date().toLocaleTimeString()}`;
    store.save({ id, label, query: currentQuery, createdAt: new Date().toISOString() });
    onStoreChanged?.();
  }, [store, currentQuery, onStoreChanged]);

  const onCopyLink = useCallback(
    (saved: SavedAuditQuery) => {
      const url = shareLink(saved.query);
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(url);
      }
      onShareLink?.(url);
    },
    [onShareLink],
  );

  const onRemove = useCallback(
    (id: string) => {
      store.remove(id);
      onStoreChanged?.();
    },
    [store, onStoreChanged],
  );

  return (
    <section
      aria-label="Saved audit queries"
      className={cn("rounded-md border border-surface-border bg-surface-raised p-3", className)}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-heading-3 font-semibold text-ink-default">Saved queries</h3>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onSave}
          aria-label="Save current query"
        >
          Save current
        </Button>
      </header>

      {list.length === 0 ? (
        <p className="mt-2 text-caption text-ink-muted">
          No saved queries yet. Build a query, then click <em>Save current</em>.
        </p>
      ) : (
        <ul className="mt-2 space-y-2" role="list">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-surface-border bg-surface px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-body-sm text-ink-default">{s.label}</div>
                <div className="truncate font-mono text-caption text-ink-subtle">
                  {summarize(s.query)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onApply(s.query)}
                  aria-label={`Apply saved query ${s.label}`}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCopyLink(s)}
                  aria-label={`Copy share link for ${s.label}`}
                >
                  Link
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(s.id)}
                  aria-label={`Remove saved query ${s.label}`}
                >
                  ×
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Label htmlFor="saved-query-label" className="sr-only">Saved query label</Label>
      <Input id="saved-query-label" type="text" className="sr-only" aria-hidden="true" tabIndex={-1} />
    </section>
  );
}

/** Build a deterministic hash-fragment URL from a query — pure function, testable. */
export function shareLink(query: AuditQuery): string {
  const encoded = encodeURIComponent(JSON.stringify(query));
  return `${typeof location !== "undefined" ? location.origin + location.pathname : ""}#audit=${encoded}`;
}

/** One-line human summary of a query, used as the secondary text in the list. */
function summarize(query: AuditQuery): string {
  const parts: string[] = [];
  if (query.text) parts.push(`text:"${query.text}"`);
  if (query.stages?.length) parts.push(`stages:${query.stages.join(",")}`);
  if (query.actorKinds?.length) parts.push(`kinds:${query.actorKinds.join(",")}`);
  if (query.since || query.until) parts.push(`time:${query.since ?? "*"}..${query.until ?? "*"}`);
  if (query.minCostUsd !== undefined) parts.push(`cost>$${query.minCostUsd}`);
  if (query.tenantId) parts.push(`tenant:${query.tenantId}`);
  return parts.length === 0 ? "(all entries)" : parts.join(" · ");
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
