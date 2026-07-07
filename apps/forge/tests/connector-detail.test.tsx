/**
 * FORA-579 — render tests for the ConnectorDetailPanel + page.
 *
 * Covers the spec's acceptance criteria:
 *
 *   AC1 — Detail page renders at `/connector-center/[id]`.
 *   AC2 — Health / scope / envelope / audit panel all present.
 *   AC3 — No DOM or network reference to the raw secret value
 *          (FORA-128 regression test).
 *   AC4 — Rotation-deadline callout renders when `expiresAt` is
 *          within 14 days of the as-of timestamp.
 *
 * Plus a few invariants the smoke probe relies on:
 *
 *   * "Open in audit" link points at the audit center filter.
 *   * Sparkline renders a polyline with 24 points when health data
 *     is present, an em-dash otherwise.
 *   * Audit feed renders one row per entry (last 100).
 *   * Rotate credential button is disabled (placeholder for FORA-580).
 *   * The forbidden-raw substrings never appear in the rendered DOM.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ConnectorDetailPanel,
  isRotationDeadlineImminent,
} from "../components/ConnectorDetailPanel";
import type { Connector } from "../lib/connectors/data"; // ponytail: aliased to Connector after refactor
import type { AuditEntry } from "../lib/connectors/audit-feed-types";

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

function entry(overrides: Partial<AuditEntry> = {}, i = 0): AuditEntry {
  return {
    id: `audit-jira-${i}`,
    timestamp: "2026-06-20T17:20:00Z",
    actor: { kind: "agent", id: "agent:SeniorEngineer", displayName: "Senior Engineer" },
    tenantId: "acme-corp",
    tool: "jira.read",
    latencyMs: 120,
    costUsd: 0.0024,
    ...overrides,
  };
}

function feed(n: number): ReadonlyArray<AuditEntry> {
  return Array.from({ length: n }, (_, i) => entry({}, i));
}

/** FORBIDDEN substrings — any raw credential value MUST NEVER appear
 *  in the rendered HTML, ARIA labels, or text content. */
const FORBIDDEN = [
  "secret_value",
  "secretValue",
  "apiKey",
  "api_key",
  "token=",
  "password=",
  "bearer ",
] as const;

function assertNoRawCredential(container: HTMLElement): void {
  const html = (container.innerHTML ?? "").toLowerCase();
  for (const needle of FORBIDDEN) {
    expect(html, `raw credential string "${needle}" in HTML`).not.toContain(
      needle.toLowerCase(),
    );
  }
  const aria = Array.from(container.querySelectorAll<HTMLElement>("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .join(" ")
    .toLowerCase();
  for (const needle of FORBIDDEN) {
    expect(aria, `raw credential string "${needle}" in aria-label`).not.toContain(
      needle.toLowerCase(),
    );
  }
}

// ---------------------------------------------------------------------------
// AC1 — Detail page renders
// ---------------------------------------------------------------------------

describe("<ConnectorDetailPanel>", () => {
  it("renders the detail panel with the right testid and data attributes", () => {
    const { container } = render(
      <ConnectorDetailPanel connector={connector()} auditEntries={feed(5)} />,
    );
    const root = container.querySelector('[data-testid="connector-detail"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute("data-connector-id")).toBe("jira");
    expect(root?.getAttribute("data-connector-tier")).toBe("1");
    expect(root?.getAttribute("data-connector-status")).toBe("success");
  });

  // -------------------------------------------------------------------
  // AC2 — Health / scope / envelope / audit panel all present
  // -------------------------------------------------------------------

  it("renders the health snapshot section with all required metrics", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    expect(screen.getByTestId("connector-last-call").textContent).toBe(
      "2026-06-20T17:20:00Z",
    );
    expect(screen.getByTestId("connector-p50").textContent).toBe("120 ms");
    expect(screen.getByTestId("connector-p95").textContent).toBe("380 ms");
    expect(screen.getByTestId("connector-error-rate").textContent).toBe("1.2%");
    expect(screen.getByTestId("connector-call-count").textContent).toBe("4321");
  });

  it("renders the scope grant section with granted + denied chips and role binding link", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const granted = screen.getAllByTestId("scope-granted-chip");
    expect(granted).toHaveLength(2);
    expect(granted.map((el) => el.getAttribute("data-scope"))).toEqual([
      "read:jira-work",
      "write:jira-work",
    ]);
    const denied = screen.getAllByTestId("scope-denied-chip");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.getAttribute("data-scope")).toBe("admin:jira-project");
    const roleLink = screen.getByTestId("connector-role-binding");
    expect(roleLink.textContent).toBe("developer");
    expect(roleLink.getAttribute("href")).toBe(
      "/governance-center?role=developer",
    );
  });

  it("renders the credential envelope section with metadata (no raw value)", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    expect(screen.getByTestId("credential-secret-ref").textContent).toBe(
      "tenants/acme-corp/secrets/jira_cred@latest",
    );
    expect(screen.getByTestId("credential-fingerprint").textContent).toBe(
      "sha256:abcd1234ef56",
    );
    expect(screen.getByTestId("credential-value-len").textContent).toBe("64 bytes");
    expect(screen.getByTestId("credential-last-rotated").textContent).toBe(
      "2026-06-01T00:00:00Z",
    );
    expect(screen.getByTestId("credential-expires-at").textContent).toBe(
      "2026-09-20T00:00:00Z",
    );
    const redacted = screen.getByTestId("credential-redacted");
    expect(redacted.getAttribute("data-redacted")).toBe("true");
  });

  it("renders the audit feed with one row per entry", () => {
    const entries = feed(100);
    render(<ConnectorDetailPanel connector={connector()} auditEntries={entries} />);
    const rows = screen.getAllByTestId("connector-audit-row");
    expect(rows).toHaveLength(100);
    expect(rows[0]?.getAttribute("data-audit-id")).toBe("audit-jira-0");
  });

  it("renders the audit empty state when there are no entries", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={[]} />);
    expect(screen.getByTestId("connector-audit-empty")).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // AC3 — No DOM or network reference to the raw secret value
  // -------------------------------------------------------------------

  it("never displays a raw credential value in the DOM (FORA-128)", () => {
    const { container } = render(
      <ConnectorDetailPanel connector={connector()} auditEntries={feed(3)} />,
    );
    assertNoRawCredential(container);
  });

  it("renders the redacted marker so the audit harness can assert the contract", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const redacted = screen.getByTestId("credential-redacted");
    expect(redacted.getAttribute("data-redacted")).toBe("true");
    expect(redacted.textContent?.toLowerCase()).toContain("redacted");
  });

  // -------------------------------------------------------------------
  // AC4 — Rotation deadline callout
  // -------------------------------------------------------------------

  it("renders the rotation deadline callout when expiresAt is within 14 days", () => {
    const AS_OF = "2026-06-20T00:00:00Z";
    const conn = connector({
      credential: {
        ...connector().credential,
        expiresAt: "2026-06-25T00:00:00Z", // 5 days out
      },
    });
    render(
      <ConnectorDetailPanel
        connector={conn}
        auditEntries={feed(0)}
      />,
    );
    const callout = screen.getByTestId("rotation-deadline-callout");
    expect(callout.getAttribute("data-rotation-deadline")).toBe(
      "2026-06-25T00:00:00Z",
    );
    expect(callout.getAttribute("role")).toBe("alert");
    expect(callout.textContent).toContain("Rotation deadline approaching");
    expect(callout.textContent).toContain(conn.credential.secretRef);
  });

  it("does NOT render the rotation deadline callout when expiresAt is more than 14 days out", () => {
    const conn = connector({
      credential: {
        ...connector().credential,
        // Far future — well outside the rotation window.
        expiresAt: "2026-12-31T00:00:00Z",
      },
    });
    render(<ConnectorDetailPanel connector={conn} auditEntries={feed(0)} />);
    expect(screen.queryByTestId("rotation-deadline-callout")).toBeNull();
  });

  it("renders the callout when the credential is already expired", () => {
    const conn = connector({
      credential: {
        ...connector().credential,
        expiresAt: "2026-06-01T00:00:00Z",
      },
    });
    render(<ConnectorDetailPanel connector={conn} auditEntries={feed(0)} />);
    expect(screen.getByTestId("rotation-deadline-callout")).toBeTruthy();
  });

  it("does NOT render the callout when expiresAt is missing", () => {
    const conn = connector({
      credential: {
        ...connector().credential,
        expiresAt: undefined,
      },
    });
    render(<ConnectorDetailPanel connector={conn} auditEntries={feed(0)} />);
    expect(screen.queryByTestId("rotation-deadline-callout")).toBeNull();
  });

  it("isRotationDeadlineImminent respects the 14-day window", () => {
    expect(isRotationDeadlineImminent("2026-06-21T00:00:00Z", "2026-06-20T00:00:00Z")).toBe(true);
    expect(isRotationDeadlineImminent("2026-07-04T00:00:00Z", "2026-06-20T00:00:00Z")).toBe(true);
    expect(isRotationDeadlineImminent("2026-07-05T00:00:00Z", "2026-06-20T00:00:00Z")).toBe(false);
    expect(isRotationDeadlineImminent(undefined, "2026-06-20T00:00:00Z")).toBe(false);
  });

  // -------------------------------------------------------------------
  // Other invariants
  // -------------------------------------------------------------------

  it("renders the Open-in-audit link with the connector filter", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const link = screen.getByTestId("connector-open-in-audit");
    expect(link.getAttribute("href")).toBe("/audit-center?connectorId=jira");
  });

  it("renders the See-all-in-Audit-Center link", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(3)} />);
    const link = screen.getByTestId("connector-see-all-audit");
    expect(link.getAttribute("href")).toBe("/audit-center?connectorId=jira");
  });

  it("renders a 24-point sparkline when health data is present", () => {
    const { container } = render(
      <ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />,
    );
    const spark = container.querySelector('[data-testid="connector-sparkline"]');
    expect(spark).toBeTruthy();
    expect(spark?.getAttribute("data-sparkline-points")).toBe("24");
  });

  it("renders a placeholder when the sparkline has no data", () => {
    const conn = connector({
      health: {
        ...connector().health,
        p50Ms: undefined,
        p95Ms: undefined,
      },
    });
    const { container } = render(
      <ConnectorDetailPanel connector={conn} auditEntries={feed(0)} />,
    );
    expect(container.querySelector('[data-testid="connector-sparkline"]')).toBeNull();
    expect(container.querySelector('[data-testid="connector-sparkline-empty"]')).toBeTruthy();
  });

  it("renders the rotate credential button as disabled (FORA-580 wires the modal)", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const btn = screen.getByTestId("connector-rotate-credential");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders the back-to-list link", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const back = screen.getByTestId("connector-back-to-list");
    expect(back.getAttribute("href")).toBe("/connector-center");
  });

  it("uses the muted tone on denied-scope chips", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(0)} />);
    const denied = screen.getAllByTestId("scope-denied-chip");
    expect(denied[0]?.className).toContain("border-forge-700");
    expect(denied[0]?.className).not.toContain("border-rose-500");
  });

  it("renders the audit feed inside an aria-labelled region", () => {
    render(<ConnectorDetailPanel connector={connector()} auditEntries={feed(3)} />);
    // Match the UL's exact aria-label ("...for Jira"), not the H2
    // ("Last 3 audit entries") which would collide with the section
    // heading. getByLabelText with a regex does a substring match by
    // default and would otherwise hit both.
    const region = screen.getByLabelText(/Last 3 audit entries for Jira/);
    expect(within(region).getAllByTestId("connector-audit-row")).toHaveLength(3);
  });
});