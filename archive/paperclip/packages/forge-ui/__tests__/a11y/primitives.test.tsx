import { render } from "@testing-library/react";
import { axe } from "../../src/testing/axe";
import { describe, expect, it } from "vitest";
import { Badge } from "../../src/primitives/badge";
import { Button } from "../../src/primitives/button";
import { Input } from "../../src/primitives/input";
import { Label } from "../../src/primitives/label";
import { LiveRegionProvider } from "../../src/a11y/live-region";
import { SkipLink } from "../../src/a11y/skip-link";
import { VisuallyHidden } from "../../src/a11y/visually-hidden";

describe("a11y: Button", () => {
  it("has no axe violations with text label", async () => {
    const { container } = render(<Button>Save</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations when disabled", async () => {
    const { container } = render(<Button disabled>Save</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("a11y: Input (with Label)", () => {
  it("has no axe violations when paired with a Label", async () => {
    const { container } = render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" />
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations when marked invalid with aria-invalid", async () => {
    const { container } = render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" invalid aria-describedby="err" />
        <span id="err">Invalid email</span>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("a11y: Badge", () => {
  it("has no axe violations across tones", async () => {
    for (const tone of ["neutral", "success", "warn", "danger", "primary", "accent"] as const) {
      const { container } = render(<Badge tone={tone}>{tone}</Badge>);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    }
  });
});

describe("a11y: SkipLink", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <>
        <SkipLink targetId="main" />
        <main id="main" />
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("a11y: VisuallyHidden", () => {
  it("keeps content in the a11y tree (still reachable for screen readers)", async () => {
    const { container, getByText } = render(
      <button aria-label="icon-only">
        <VisuallyHidden>Save</VisuallyHidden>
        <span aria-hidden="true">💾</span>
      </button>,
    );
    // Element is in the DOM but visually hidden.
    expect(getByText("Save")).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("a11y: LiveRegionProvider", () => {
  it("renders two ARIA live regions (polite + assertive) without violations", async () => {
    const { container } = render(
      <LiveRegionProvider>
        <div>App</div>
      </LiveRegionProvider>,
    );
    expect(container.querySelector('[data-forge-live="polite"]')).not.toBeNull();
    expect(container.querySelector('[data-forge-live="assertive"]')).not.toBeNull();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
