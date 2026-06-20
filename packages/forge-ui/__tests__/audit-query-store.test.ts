/**
 * FORA-505 / FORA-393-6 — AuditQueryStore (sessionStorage-backed) tests.
 *
 * Validates AC #3: "Saved queries persist per-user" — per-user = per-browser
 * in v1.0. Validates that storage operations are session-scoped: a fresh
 * store instance with no backing storage is an in-memory drop-in.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSessionAuditQueryStore } from "../src/audit/audit-query-store";
import type { SavedAuditQuery } from "../src/audit/types";

function inMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(key: string) { return map.get(key) ?? null; },
    key(i: number) { return Array.from(map.keys())[i] ?? null; },
    removeItem(key: string) { map.delete(key); },
    setItem(key: string, value: string) { map.set(key, value); },
  };
}

const sample: SavedAuditQuery = {
  id: "q-1",
  label: "Last hour",
  query: { since: "2026-06-20T13:00:00.000Z", actorKinds: ["agent"] },
  createdAt: "2026-06-20T13:01:00.000Z",
};

describe("AuditQueryStore", () => {
  let store: ReturnType<typeof createSessionAuditQueryStore>;
  let storage: Storage;

  beforeEach(() => {
    storage = inMemoryStorage();
    store = createSessionAuditQueryStore(storage);
  });

  it("returns an empty list when storage is empty", () => {
    expect(store.list()).toEqual([]);
  });

  it("saves and re-reads a saved query", () => {
    store.save(sample);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(sample.id);
    expect(list[0]?.query).toEqual(sample.query);
  });

  it("deduplicates by id when saving an updated query", () => {
    store.save(sample);
    store.save({ ...sample, label: "Last hour (updated)" });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.label).toBe("Last hour (updated)");
  });

  it("removes a saved query by id", () => {
    store.save(sample);
    store.save({ ...sample, id: "q-2" });
    store.remove("q-1");
    expect(store.list().map((q) => q.id)).toEqual(["q-2"]);
  });

  it("clears the storage key when the last query is removed", () => {
    store.save(sample);
    expect(storage.getItem("forge-audit-saved-queries/v1")).not.toBeNull();
    store.remove(sample.id);
    expect(storage.getItem("forge-audit-saved-queries/v1")).toBeNull();
  });

  it("persists lastQuery separately from the saved list", () => {
    store.setLastQuery({ text: "jira" });
    expect(store.getLastQuery()).toEqual({ text: "jira" });
    store.save(sample);
    // lastQuery is independent.
    expect(store.getLastQuery()).toEqual({ text: "jira" });
    expect(store.list()).toHaveLength(1);
  });

  it("ignores malformed storage content (defense-in-depth)", () => {
    storage.setItem("forge-audit-saved-queries/v1", "{not-json");
    expect(store.list()).toEqual([]);
    storage.setItem("forge-audit-saved-queries/v1", JSON.stringify([
      { id: "good", label: "ok", createdAt: "now", query: {} },
      { id: "missing-label" }, // dropped by the defensive filter
      "not-an-object",
    ]));
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("good");
  });

  it("clear() wipes both the saved list and the last query", () => {
    store.save(sample);
    store.setLastQuery({ text: "x" });
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.getLastQuery()).toBeNull();
  });
});
