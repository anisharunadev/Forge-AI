import { describe, it, expect } from "vitest";
import { resolveConventions, applyTokensToDocument } from "../src/tokens/conventions";

describe("resolveConventions", () => {
  it("returns KnackForge defaults when no override supplied", () => {
    const result = resolveConventions();
    expect(result.tokens["brand-primary"]).toBe("252 100% 68%");
    expect(result.personaTheme.pm).toBe("light");
    expect(result.personaTheme.cto).toBe("dark");
    expect(result.personaTheme.customer).toBe("system");
  });

  it("applies customer token overrides on top of defaults", () => {
    const result = resolveConventions({
      customerSlug: "acme",
      tokens: { "brand-primary": "210 100% 50%" },
    });
    expect(result.tokens["brand-primary"]).toBe("210 100% 50%");
    expect(result.tokens["brand-accent"]).toBe("162 78% 42%"); // untouched
  });

  it("applies customer persona-theme overrides", () => {
    const result = resolveConventions({
      customerSlug: "acme",
      personaTheme: { pm: "dark" },
    });
    expect(result.personaTheme.pm).toBe("dark");
    expect(result.personaTheme.cto).toBe("dark");
  });
});

describe("applyTokensToDocument", () => {
  it("writes CSS variables to document.documentElement.style", () => {
    applyTokensToDocument({ "brand-primary": "210 100% 50%" });
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe(
      "210 100% 50%",
    );
  });
});