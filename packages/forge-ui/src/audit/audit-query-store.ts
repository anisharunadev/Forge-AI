/**
 * AuditQueryStore — per-user saved-query persistence — FORA-393 Plan 1 §3.12.
 *
 * Storage: `sessionStorage` (per-browser, per-user, per-session). The
 * investigation mode + saved-query state are session-scoped by design; they
 * never cross tenants and never persist past the browser tab. This matches
 * the AC: "Investigation mode toggle is session-scoped (not tenant-scoped)"
 * and "Saved queries persist per-user" (per-user = per-browser-tab in v1.0).
 *
 * v1.1 will swap to the audit-spine server endpoint (FORA-399) and the
 * `SavedAuditQuery.shareLink` field will become canonical.
 */

import type { SavedAuditQuery } from "./types";

const STORAGE_KEY = "forge-audit-saved-queries/v1";
const LAST_QUERY_KEY = "forge-audit-last-query/v1";

export interface AuditQueryStore {
  list(): ReadonlyArray<SavedAuditQuery>;
  save(query: SavedAuditQuery): void;
  remove(id: string): void;
  getLastQuery(): unknown;
  setLastQuery(query: unknown): void;
  clear(): void;
}

/**
 * Build a query store backed by `sessionStorage`. Falls back to an in-memory
 * store when `sessionStorage` is unavailable (SSR, privacy mode, tests).
 */
export function createSessionAuditQueryStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = pickSessionStorage(),
): AuditQueryStore {
  const mem = new Map<string, string>();
  const backend: Pick<Storage, "getItem" | "setItem" | "removeItem"> = storage ?? {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };

  return {
    list(): ReadonlyArray<SavedAuditQuery> {
      const raw = backend.getItem(STORAGE_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        // Defensive: only accept objects with the four required keys.
        return parsed.filter(
          (q): q is SavedAuditQuery =>
            typeof q === "object" &&
            q !== null &&
            typeof (q as { id?: unknown }).id === "string" &&
            typeof (q as { label?: unknown }).label === "string" &&
            typeof (q as { createdAt?: unknown }).createdAt === "string" &&
            typeof (q as { query?: unknown }).query === "object",
        );
      } catch {
        return [];
      }
    },
    save(query: SavedAuditQuery): void {
      const current = this.list();
      const next = [...current.filter((q) => q.id !== query.id), query];
      backend.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    remove(id: string): void {
      const current = this.list();
      const next = current.filter((q) => q.id !== id);
      if (next.length === 0) backend.removeItem(STORAGE_KEY);
      else backend.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    getLastQuery(): unknown {
      const raw = backend.getItem(LAST_QUERY_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    setLastQuery(query: unknown): void {
      backend.setItem(LAST_QUERY_KEY, JSON.stringify(query));
    },
    clear(): void {
      backend.removeItem(STORAGE_KEY);
      backend.removeItem(LAST_QUERY_KEY);
    },
  };
}

function pickSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    // Probe — Safari private mode + some embedded webviews throw on access.
    const probeKey = "__forge_audit_probe__";
    window.sessionStorage.setItem(probeKey, "1");
    window.sessionStorage.removeItem(probeKey);
    return window.sessionStorage;
  } catch {
    return null;
  }
}
