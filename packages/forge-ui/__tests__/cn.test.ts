import { describe, it, expect } from "vitest";
import { cn } from "../src/tokens/cn";

describe("cn", () => {
  it("merges tailwind utilities deterministically (later wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("returns empty string for empty input", () => {
    expect(cn()).toBe("");
  });
});