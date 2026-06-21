/**
 * FORA-505 / FORA-393-6 — axe-core a11y test for the Audit Center.
 *
 * AC: "axe-core green." Mirrors the FORA-393-F1 pattern in graph.a11y.test.tsx:
 * render the composer with a small fixture, run axe with the wcag2a tag, and
 * expect zero violations.
 */

import { describe, it, expect } from "vitest";
import { axe, renderWithProviders } from "../../src/testing";
import {
  AuditCenter,
  createSessionAuditQueryStore,
} from "../../src/audit";
import { AuditGraphProvider, InMemoryAuditFetcher } from "../../src/graph/providers/audit";
import type { AuditEntry } from "../../src/typed-artifacts/types";

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

const TENANT = "acme";
const FIXTURES: ReadonlyArray<AuditEntry> = [
  {
    id: "e1",
    timestamp: "2026-06-20T10:00:00.000Z",
    actor: { kind: "user", id: "u1", displayName: "Alice" },
    tenantId: TENANT,
    tool: "developer",
    costUsd: 0.001,
  },
  {
    id: "e2",
    timestamp: "2026-06-20T11:00:00.000Z",
    actor: { kind: "agent", id: "agent-1" },
    tenantId: TENANT,
    tool: "qa",
    costUsd: 0.50,
  },
];

function buildProvider(): AuditGraphProvider {
  const fetcher = new InMemoryAuditFetcher();
  fetcher.setEntries([{ id: "n1", family: "audit", kind: "audit_entry", label: "n1" }]);
  return new AuditGraphProvider(fetcher, { pollMs: 60_000 });
}

describe("AuditCenter a11y (axe-core, wcag2a)", () => {
  it("has no WCAG 2 A violations", async () => {
    const { container } = renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(inMemoryStorage())}
        fetchEntries={async () => FIXTURES}
      />,
    );
    const results = await axe(container, { runOnly: { type: "tag", values: ["wcag2a"] } });
    expect(results.violations).toEqual([]);
  });
});
