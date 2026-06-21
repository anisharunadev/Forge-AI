/**
 * Connector Center — MCP coverage for new adapters (ClickUp, Adobe XD,
 * Kiro). Verifies:
 *
 *   AC1 — `lib/mcp-registry.ts` contains entries for clickup, adobe_xd,
 *          and kiro (no duplicates; project_management / design /
 *          version_control categories respectively).
 *   AC2 — The marketplace adapter surfaces all 3 new MCPs with valid
 *          rating + install counts (registry-driven render).
 *   AC3 — The MarketplaceCard renders per-connector icons via the
 *          mcp-icon resolver (no plain `Plug` fallback for any of the 3).
 *   AC4 — `lib/connectors/audit-feed-types.ts` exposes tool-name unions
 *          for the new MCPs (typed `<server>.<tool>` strings).
 *
 * Kept separate from `connector-card.test.tsx` (FORA-578 legacy root
 * card) so the marketplace-card test stays isolated to the registry-
 * driven marketplace render path.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MarketplaceCard } from "../components/connector-center/MarketplaceCard";
import {
  listMarketplaceFromRegistry,
  getMarketplaceFromRegistry,
} from "../lib/connector-center/mcp-adapter";
import {
  listMCPServers,
  getMCPServer,
} from "../lib/mcp-registry";
import {
  MCP_TOOLS,
  mcpAuditTool,
  type AuditMCPServerId,
} from "../lib/connectors/audit-feed-types";

describe("MCP registry — new adapters", () => {
  it("contains clickup, adobe_xd, and kiro entries", () => {
    const ids = listMCPServers().map((s) => s.name);
    expect(ids).toContain("clickup");
    expect(ids).toContain("adobe_xd");
    expect(ids).toContain("kiro");
  });

  it("has exactly one clickup entry (no duplicates)", () => {
    const matches = listMCPServers().filter((s) => s.name === "clickup");
    expect(matches).toHaveLength(1);
  });

  it("classifies the 3 new MCPs in their expected categories", () => {
    expect(getMCPServer("clickup")?.category).toBe("project_management");
    expect(getMCPServer("adobe_xd")?.category).toBe("design");
    expect(getMCPServer("kiro")?.category).toBe("version_control");
  });

  it("declares required config schema fields per MCP", () => {
    const clickup = getMCPServer("clickup");
    expect(clickup?.configSchema.required).toEqual(
      expect.arrayContaining(["api_token", "workspace_id"]),
    );
    expect(clickup?.authMethods).toEqual(
      expect.arrayContaining(["api_token", "oauth"]),
    );

    const xd = getMCPServer("adobe_xd");
    expect(xd?.configSchema.required).toEqual(
      expect.arrayContaining(["client_id", "client_secret"]),
    );
    expect(xd?.authMethods).toContain("oauth");

    const kiro = getMCPServer("kiro");
    expect(kiro?.configSchema.required).toContain("api_token");
    expect(kiro?.authMethods).toContain("api_token");
  });

  it("exposes non-empty capability lists for each new MCP", () => {
    for (const id of ["clickup", "adobe_xd", "kiro"] as const) {
      const caps = getMCPServer(id)?.capabilities ?? [];
      expect(caps.length).toBeGreaterThan(0);
    }
  });
});

describe("MCP adapter — marketplace surfaces the 3 new adapters", () => {
  it("listMarketplaceFromRegistry includes all 3 new ids", () => {
    const ids = listMarketplaceFromRegistry().map((m) => m.id);
    expect(ids).toContain("clickup");
    expect(ids).toContain("adobe_xd");
    expect(ids).toContain("kiro");
  });

  it("getMarketplaceFromRegistry returns a rating + install count for each", () => {
    for (const id of ["clickup", "adobe_xd", "kiro"] as const) {
      const row = getMarketplaceFromRegistry(id);
      expect(row).toBeDefined();
      expect(row?.rating).toBeGreaterThan(0);
      expect(row?.installs).toBeGreaterThan(0);
      expect(row?.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe("MarketplaceCard — per-connector icons for the new MCPs", () => {
  for (const id of ["clickup", "adobe_xd", "kiro"] as const) {
    it(`renders a ${id} card with a registry-driven connector id`, () => {
      const row = getMarketplaceFromRegistry(id);
      expect(row).toBeDefined();
      const { container } = render(<MarketplaceCard connector={row!} />);
      const card = container.querySelector('[data-testid="marketplace-card"]');
      expect(card?.getAttribute("data-connector-id")).toBe(id);
      expect(card?.getAttribute("data-connector-icon")).toBe(id);
    });
  }

  it("renders the connector display name and description", () => {
    const row = getMarketplaceFromRegistry("adobe_xd");
    const { container } = render(<MarketplaceCard connector={row!} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Adobe XD");
    expect(html).toContain("prototypes");
  });
});

describe("audit-feed-types — tool-name unions for the new MCPs", () => {
  it("MCP_TOOLS includes the 3 new MCP ids with at least one tool each", () => {
    const ids: ReadonlyArray<AuditMCPServerId> = [
      "clickup",
      "adobe_xd",
      "kiro",
    ];
    for (const id of ids) {
      const tools = MCP_TOOLS[id];
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it("mcpAuditTool produces `<server>.<tool>` strings", () => {
    expect(mcpAuditTool("clickup", "create_task")).toBe("clickup.create_task");
    expect(mcpAuditTool("adobe_xd", "read_prototypes")).toBe(
      "adobe_xd.read_prototypes",
    );
    expect(mcpAuditTool("kiro", "trigger_agent")).toBe("kiro.trigger_agent");
  });

  it("every tool listed for the new MCPs is non-empty", () => {
    for (const id of ["clickup", "adobe_xd", "kiro"] as const) {
      for (const t of MCP_TOOLS[id]) {
        expect(t.length).toBeGreaterThan(0);
      }
    }
  });
});