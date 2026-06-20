/**
 * FORA-501 — RBAC tests for the Project Intelligence center.
 *
 * PM is primary. Eng Lead + CTO can view (audit read-only).
 */

import { describe, expect, it } from "vitest";
import {
  canAccessProjectIntelligence,
  escalationPersona,
  escalationPersonaLabel,
  isAuditPersona,
} from "../../lib/intelligence/rbac";

describe("canAccessProjectIntelligence", () => {
  it("allows pm", () => {
    expect(canAccessProjectIntelligence("pm")).toBe(true);
  });

  it("allows eng-lead", () => {
    expect(canAccessProjectIntelligence("eng-lead")).toBe(true);
  });

  it("allows cto", () => {
    expect(canAccessProjectIntelligence("cto")).toBe(true);
  });
});

describe("isAuditPersona", () => {
  it("pm is not audit (primary read-write)", () => {
    expect(isAuditPersona("pm")).toBe(false);
  });

  it("eng-lead is audit", () => {
    expect(isAuditPersona("eng-lead")).toBe(true);
  });

  it("cto is audit", () => {
    expect(isAuditPersona("cto")).toBe(true);
  });
});

describe("escalationPersona / escalationPersonaLabel", () => {
  it("always returns pm as the escalation persona", () => {
    expect(escalationPersona("eng-lead")).toBe("pm");
    expect(escalationPersona("cto")).toBe("pm");
  });

  it("returns the human-readable label 'Product Manager'", () => {
    expect(escalationPersonaLabel("eng-lead")).toBe("Product Manager");
  });
});