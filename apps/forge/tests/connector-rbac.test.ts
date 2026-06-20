/**
 * FORA-578 — RBAC tests for the Connector Center list page.
 *
 * Only Eng Lead and CTO personas can audit the connector list. PM is
 * intentionally blocked and sees a typed-artifact empty-state.
 */

import { describe, expect, it } from "vitest";
import {
  canAccessConnectorCenter,
  escalationPersona,
  escalationPersonaLabel,
} from "../lib/connectors/rbac";

describe("canAccessConnectorCenter", () => {
  it("allows eng-lead", () => {
    expect(canAccessConnectorCenter("eng-lead")).toBe(true);
  });

  it("allows cto", () => {
    expect(canAccessConnectorCenter("cto")).toBe(true);
  });

  it("denies pm", () => {
    expect(canAccessConnectorCenter("pm")).toBe(false);
  });
});

describe("escalationPersona / escalationPersonaLabel", () => {
  it("returns the eng-lead persona for any blocked persona", () => {
    expect(escalationPersona("pm")).toBe("eng-lead");
  });

  it("returns the human-readable label 'Engineering Lead'", () => {
    expect(escalationPersonaLabel("pm")).toBe("Engineering Lead");
  });
});