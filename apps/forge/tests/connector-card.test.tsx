/**
 * FORA-578 — render tests for the ConnectorCard.
 *
 * Covers:
 *   AC3 — Cards render the status pill.
 *   AC4 — Cards render health (last call, error rate).
 *   AC5 — Cards render scope chips (granted + denied) per scope.
 *   AC6 — Card never displays a raw credential value; the envelope
 *          is always redacted per FORA-128.
 *   AC7 — Card has an "Open" link to the per-connector detail page.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ConnectorCard } from "../components/ConnectorCard";
import type { Connector } from "../lib/connectors/data"; // ponytail: aliased to Connector after refactor

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "jira",
    name: "jira",
    displayName: "Jira",
    tenantId: "acme-corp",
    status: "success",
    tier: 1,
    health: {
      lastCallAt: "2026-06-20T17:20:00Z",
      p50Ms: 120,
      p95Ms: 380,
      errorRate: 0.012,
      callCount24h: 4321,
    },
    scope: {
      grantedScopes: ["read:jira-work", "write:jira-work"],
      deniedScopes: ["admin:jira-project"],
      roleBinding: "developer",
    },
    credential: {
      secretRef: "tenants/acme-corp/secrets/jira_cred@latest",
      redacted: true,
      valueLen: 64,
      fingerprint: "sha256:abcd1234ef56",
      lastRotatedAt: "2026-06-01T00:00:00Z",
      expiresAt: "2026-09-20T00:00:00Z",
    },
    lastUsedAt: "2026-06-20T17:20:00Z",
    lastAuditEntryId: "audit-7",
    ...overrides,
  };
}

describe("<ConnectorCard>", () => {
  it("renders the status pill with the success tone", () => {
    render(<ConnectorCard connector={connector()} />);
    const pill = screen.getByTestId("connector-status-pill");
    expect(pill.getAttribute("data-status")).toBe("success");
    expect(pill.textContent?.toLowerCase()).toContain("healthy");
  });

  it("renders the degraded status pill when status === degraded", () => {
    render(<ConnectorCard connector={connector({ status: "degraded" })} />);
    const pill = screen.getByTestId("connector-status-pill");
    expect(pill.getAttribute("data-status")).toBe("degraded");
    expect(pill.textContent?.toLowerCase()).toContain("degraded");
  });

  it("renders the broken status pill when status === error", () => {
    render(<ConnectorCard connector={connector({ status: "error" })} />);
    const pill = screen.getByTestId("connector-status-pill");
    expect(pill.getAttribute("data-status")).toBe("error");
    expect(pill.textContent?.toLowerCase()).toContain("broken");
  });

  it("renders health metrics (last call + error rate)", () => {
    render(<ConnectorCard connector={connector()} />);
    expect(screen.getByTestId("connector-last-call").textContent).toBe(
      "2026-06-20T17:20:00Z",
    );
    expect(screen.getByTestId("connector-error-rate").textContent).toBe("1.2%");
    expect(screen.getByTestId("connector-latency").textContent).toBe("120 ms / 380 ms");
  });

  it("renders one chip per granted scope and one chip per denied scope", () => {
    render(<ConnectorCard connector={connector()} />);
    const granted = screen.getAllByTestId("scope-granted-chip");
    expect(granted).toHaveLength(2);
    expect(granted.map((el) => el.getAttribute("data-scope"))).toEqual([
      "read:jira-work",
      "write:jira-work",
    ]);
    const denied = screen.getAllByTestId("scope-denied-chip");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.getAttribute("data-scope")).toBe("admin:jira-project");
  });

  it("renders an empty-granted chip when there are no granted scopes", () => {
    render(
      <ConnectorCard
        connector={connector({
          scope: { grantedScopes: [], roleBinding: "developer" },
        })}
      />,
    );
    expect(screen.getByTestId("scope-granted-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("scope-granted-chip")).toHaveLength(0);
  });

  it("never displays a raw credential value (FORA-128)", () => {
    const { container } = render(<ConnectorCard connector={connector()} />);
    const html = container.textContent ?? "";
    expect(html).not.toMatch(/secret_value/i);
    expect(html).not.toMatch(/api_?key/i);
    expect(html).not.toMatch(/password=/i);
    const redacted = screen.getByTestId("credential-redacted");
    expect(redacted.getAttribute("data-redacted")).toBe("true");
  });

  it("renders an Open link to the per-connector detail page", () => {
    render(<ConnectorCard connector={connector()} />);
    const link = screen.getByTestId("connector-open");
    expect(link.getAttribute("href")).toBe("/connector-center/jira");
    expect(link.getAttribute("aria-label")).toContain("Jira");
  });

  it("sets the row-level data attributes for the smoke probe", () => {
    const { container } = render(<ConnectorCard connector={connector()} />);
    const row = container.querySelector('[data-testid="connector-row"]');
    expect(row?.getAttribute("data-connector-id")).toBe("jira");
    expect(row?.getAttribute("data-connector-tier")).toBe("1");
    expect(row?.getAttribute("data-connector-status")).toBe("success");
  });

  it("groups scope chips under an aria-labelled region for screen readers", () => {
    render(<ConnectorCard connector={connector()} />);
    const scopeRegion = screen.getByLabelText("Scope grant");
    expect(within(scopeRegion).getAllByTestId("scope-granted-chip").length).toBe(2);
    expect(within(scopeRegion).getAllByTestId("scope-denied-chip").length).toBe(1);
  });
});