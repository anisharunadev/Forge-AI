import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import {
  McpConnectorRenderer,
  ConnectorStatusPill,
  type McpConnector,
  type ToolCallStatus,
} from "../src/typed-artifacts";

const SAMPLE: McpConnector = {
  id: "jira",
  name: "jira",
  displayName: "Jira",
  tenantId: "tnt_8XQ",
  status: "success",
  tier: 1,
  health: {
    lastCallAt: "2026-06-20T17:00:00Z",
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
    secretRef: "tenants/tnt_8XQ/secrets/jira_pat@latest",
    redacted: true,
    valueLen: 64,
    fingerprint: "sha256:abcd1234ef56",
    expiresAt: "2026-09-20T00:00:00Z",
    lastRotatedAt: "2026-06-01T00:00:00Z",
  },
  lastUsedAt: "2026-06-20T17:00:00Z",
  lastAuditEntryId: "audit-7",
};

/**
 * Forbidden substrings — any raw credential value MUST NEVER appear in
 * the rendered HTML, ARIA labels, or text content of any McpConnector
 * variant. The CI lint and these regression tests guard the contract
 * from FORA-128: secrets-mcp v0 — redacted envelope.
 */
const FORBIDDEN_RAW_FIELDS = [
  "secret_value",
  "secretValue",
  "apiKey",
  "api_key",
  "token=",
  "password=",
  "bearer ",
] as const;

function assertNoRawCredential(container: HTMLElement): void {
  const html = container.innerHTML.toLowerCase();
  for (const needle of FORBIDDEN_RAW_FIELDS) {
    expect(html).not.toContain(needle.toLowerCase());
  }
  // ARIA labels, too.
  const aria = container
    .querySelectorAll("[aria-label]")
    ? Array.from(container.querySelectorAll<HTMLElement>("[aria-label]"))
        .map((el) => el.getAttribute("aria-label") ?? "")
        .join(" ")
        .toLowerCase()
    : "";
  for (const needle of FORBIDDEN_RAW_FIELDS) {
    expect(aria).not.toContain(needle.toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// McpConnectorRenderer — summary-card variant
// ---------------------------------------------------------------------------

describe("McpConnectorRenderer / summary-card", () => {
  it("renders display name, id, status pill, and summary metadata", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="summary-card" />,
    );
    expect(getByText("Jira")).toBeInTheDocument();
    expect(getByText("jira")).toBeInTheDocument();
    expect(getByLabelText("Status: healthy")).toBeInTheDocument();
    expect(getByText("developer")).toBeInTheDocument();
  });

  it("does not render any raw credential value (FORA-128 contract)", () => {
    const { container } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="summary-card" />,
    );
    assertNoRawCredential(container);
  });
});

// ---------------------------------------------------------------------------
// McpConnectorRenderer — detail-panel variant
// ---------------------------------------------------------------------------

describe("McpConnectorRenderer / detail-panel", () => {
  it("renders header, health, scope, and credential-envelope sections", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="detail-panel" />,
    );
    // Header
    expect(getByText("Jira")).toBeInTheDocument();
    expect(getByText("Tier 1 connector ·")).toBeInTheDocument();
    // Health
    expect(getByText("Health snapshot")).toBeInTheDocument();
    expect(getByText("120 ms")).toBeInTheDocument();
    expect(getByText("380 ms")).toBeInTheDocument();
    expect(getByText("1.2%")).toBeInTheDocument();
    // Scope
    expect(getByText("Scope grant")).toBeInTheDocument();
    expect(getByLabelText("Granted: read:jira-work")).toBeInTheDocument();
    expect(getByLabelText("Granted: write:jira-work")).toBeInTheDocument();
    expect(getByLabelText("Denied: admin:jira-project")).toBeInTheDocument();
    // Credential
    expect(getByText("Credential envelope")).toBeInTheDocument();
    expect(getByText("tenants/tnt_8XQ/secrets/jira_pat@latest")).toBeInTheDocument();
    expect(getByText("sha256:abcd1234ef56")).toBeInTheDocument();
    expect(getByText("64 bytes")).toBeInTheDocument();
    // The redacted marker is rendered, never the raw value.
    expect(getByText("Redacted")).toBeInTheDocument();
  });

  it("does not render any raw credential value (FORA-128 contract)", () => {
    const { container } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="detail-panel" />,
    );
    assertNoRawCredential(container);
  });
});

// ---------------------------------------------------------------------------
// McpConnectorRenderer — row variant
// ---------------------------------------------------------------------------

describe("McpConnectorRenderer / row", () => {
  it("renders display name, id, status pill, error rate, calls, last call", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="row" />,
    );
    expect(getByText("Jira")).toBeInTheDocument();
    expect(getByLabelText("Status: healthy")).toBeInTheDocument();
    expect(getByLabelText("Error rate")).toHaveTextContent("1.2%");
    expect(getByLabelText("Calls 24h")).toHaveTextContent("4321");
  });

  it("does not render any raw credential value (FORA-128 contract)", () => {
    const { container } = renderWithProviders(
      <McpConnectorRenderer artifact={SAMPLE} variant="row" />,
    );
    assertNoRawCredential(container);
  });
});

// ---------------------------------------------------------------------------
// ConnectorStatusPill — Plan 3 §7.1 brand-token mapping
// ---------------------------------------------------------------------------

describe("ConnectorStatusPill", () => {
  const cases: ReadonlyArray<{
    status: ToolCallStatus;
    label: string;
    toneClass: RegExp;
  }> = [
    {
      status: "success",
      label: "healthy",
      toneClass: /text-brand-success|brand-success/,
    },
    {
      status: "degraded",
      label: "degraded",
      toneClass: /text-brand-warn|brand-warn/,
    },
    {
      status: "error",
      label: "broken",
      toneClass: /text-brand-danger|brand-danger/,
    },
  ];

  for (const c of cases) {
    it(`renders the right text + aria-label + brand tone for ${c.status}`, () => {
      const { getByText, getByLabelText, container } = renderWithProviders(
        <ConnectorStatusPill status={c.status} />,
      );
      expect(getByText(c.label)).toBeInTheDocument();
      expect(getByLabelText(`Status: ${c.label}`)).toBeInTheDocument();
      // The brand tone class must be on the badge (tone is rendered through
      // cva — the class string includes `text-brand-{tone}`).
      expect(container.firstElementChild?.className ?? "").toMatch(c.toneClass);
    });
  }

  it("exposes the status on data-status for tests + observability", () => {
    const { getByTestId } = renderWithProviders(
      <ConnectorStatusPill status="degraded" />,
    );
    expect(getByTestId("connector-status-pill").getAttribute("data-status")).toBe(
      "degraded",
    );
  });
});
