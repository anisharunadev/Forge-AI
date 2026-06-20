import { describe, expect, it } from "vitest";
import {
  applyTokensToDocument,
  resolveConventions,
} from "../../src/tokens/conventions";

describe("resolveConventions", () => {
  it("returns KnackForge defaults when no override is supplied", () => {
    const res = resolveConventions();
    expect(res.tokens["brand-primary"]).toBe("252 100% 68%");
    expect(res.personaTheme.pm).toBe("light");
    expect(res.personaTheme.cto).toBe("dark");
    expect(res.personaTheme.customer).toBe("system");
  });

  it("merges customer tokens on top of KnackForge defaults (override wins)", () => {
    const res = resolveConventions({
      customerSlug: "acme",
      tokens: { "brand-primary": "210 100% 50%" },
    });
    expect(res.tokens["brand-primary"]).toBe("210 100% 50%");
    // KnackForge defaults remain for unset keys.
    expect(res.tokens["brand-accent"]).toBe("162 78% 42%");
  });

  it("merges customer persona theme overrides", () => {
    const res = resolveConventions({
      customerSlug: "acme",
      personaTheme: { pm: "dark" },
    });
    expect(res.personaTheme.pm).toBe("dark");
    expect(res.personaTheme.cto).toBe("dark");
  });

  it("treats null override as no override", () => {
    const res = resolveConventions(null);
    expect(res.tokens["brand-primary"]).toBe("252 100% 68%");
  });
});

describe("applyTokensToDocument", () => {
  it("writes CSS custom properties to document.documentElement", () => {
    applyTokensToDocument({ "brand-primary": "210 100% 50%" });
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe(
      "210 100% 50%",
    );
  });

  it("is a noop on the server (no document global)", () => {
    const originalDocument = globalThis.document;
    delete (globalThis as { document?: unknown }).document;
    expect(() => applyTokensToDocument({ x: "y" })).not.toThrow();
    (globalThis as { document?: unknown }).document = originalDocument;
  });
});
