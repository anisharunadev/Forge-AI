/**
 * FORA-505 / FORA-393-6 — AuditCenter composer integration tests.
 *
 * Tests the composer at the unit level: query builder propagates changes,
 * saved-queries panel mutates the store and notifies the composer, the
 * investigation toggle wires into the existing useTheme hook, the export
 * button stays disabled.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../src/testing/render-with-providers";
import {
  AuditCenter,
  createSessionAuditQueryStore,
  TenantScopedAuditFetcher,
} from "../src/audit";
import { InMemoryAuditFetcher } from "../src/graph/providers/audit";
import { AuditGraphProvider } from "../src/graph/providers/audit";
import type { AuditEntry } from "../src/typed-artifacts/types";

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
  {
    id: "e3",
    timestamp: "2026-06-20T12:30:00.000Z",
    actor: { kind: "system", id: "probe" },
    tenantId: TENANT,
    tool: "audit",
    costUsd: 5.00,
  },
];

function buildProvider(): AuditGraphProvider {
  const fetcher = new InMemoryAuditFetcher();
  // The audit graph provider doesn't care about node contents for these
  // composer tests — we exercise the query logic via fetchEntries, not the
  // graph. The provider exists so the AuditTimelineGraphCanvas mounts.
  fetcher.setEntries([{ id: "n1", family: "audit", kind: "audit_entry", label: "n1" }]);
  return new AuditGraphProvider(fetcher, { pollMs: 60_000 });
}

describe("AuditCenter composer", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = inMemoryStorage();
  });

  it("renders the query builder, saved queries panel, and timeline", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    expect(screen.getByRole("region", { name: "Audit Center" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /audit log query builder/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /saved audit queries/i })).toBeInTheDocument();
    // React Flow's inner viewport also reports role="application" with its
    // own aria-label — we just need to confirm the canvas section is mounted.
    expect(screen.getAllByRole("application", { name: /audit timeline graph/i }).length).toBeGreaterThan(0);
  });

  it("reflects the number of matching entries (live region)", async () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    expect(await screen.findByText("3 entries")).toBeInTheDocument();
  });

  it("filters results as the user types in the search field", async () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    const input = screen.getByLabelText(/contains/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "qa" } });
    expect(await screen.findByText("1 entries")).toBeInTheDocument();
  });

  it("renders the investigation mode toggle (off by default)", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    const toggle = screen.getByLabelText(/investigation mode off/i);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/investigation mode on/i)).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the v1.1 export button disabled with a tooltip", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    const exportBtn = screen.getByRole("button", { name: /export audit log/i });
    expect(exportBtn).toBeDisabled();
    expect(exportBtn).toHaveAttribute("aria-disabled", "true");
    expect(exportBtn).toHaveAttribute("title", expect.stringContaining("v1.1"));
  });

  it("saves the current query via the saved-queries panel", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save current query/i }));
    const list = createSessionAuditQueryStore(storage).list();
    expect(list).toHaveLength(1);
    expect(list[0]?.query.tenantId).toBe(TENANT);
  });

  it("removes a saved query via the panel", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save current query/i }));
    expect(screen.getByText(/^Query /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove saved query / }));
    expect(createSessionAuditQueryStore(storage).list()).toEqual([]);
  });

  it("forces the tenant axis to the locked tenant scope (no cross-tenant UI path)", () => {
    renderWithProviders(
      <AuditCenter
        provider={buildProvider()}
        tenantScope={TENANT}
        store={createSessionAuditQueryStore(storage)}
        fetchEntries={async () => FIXTURES}
      />,
    );
    const tenantInput = screen.getByLabelText(/tenant id/i) as HTMLInputElement;
    expect(tenantInput.value).toBe(TENANT);
    expect(tenantInput).toHaveAttribute("readonly");
  });
});

describe("TenantScopedAuditFetcher integration", () => {
  it("does not invoke the fetcher with an empty tenantId", () => {
    const fetcher = new InMemoryAuditFetcher();
    const listSpy = vi.spyOn(fetcher, "listEntries");
    const scoped = new TenantScopedAuditFetcher(fetcher, { tenantId: "acme" });
    void scoped.listEntries();
    expect(listSpy).toHaveBeenCalled();
    // Cross-check: empty tenant id throws.
    expect(
      () => new TenantScopedAuditFetcher(fetcher, { tenantId: "" }),
    ).toThrow();
  });
});
