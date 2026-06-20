import { describe, expect, it } from "vitest";
import { cn } from "../../src/tokens/cn";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, 0, "", "b")).toBe("a b");
  });

  it("resolves Tailwind utility conflicts deterministically (twMerge)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("supports conditional arrays", () => {
    expect(cn("base", ["x", null, "y"])).toBe("base x y");
  });
});
