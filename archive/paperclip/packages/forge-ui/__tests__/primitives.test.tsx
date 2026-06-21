import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { Button } from "../src/primitives/button";
import { Badge } from "../src/primitives/badge";
import { Input } from "../src/primitives/input";
import { Label } from "../src/primitives/label";

describe("Button", () => {
  it("renders with default type=button to avoid form submits", () => {
    const { getByRole } = renderWithProviders(<Button>Save</Button>);
    const btn = getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("supports asChild via Radix Slot", () => {
    const { getByRole } = renderWithProviders(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>,
    );
    const link = getByRole("link", { name: "Link" });
    expect(link.tagName).toBe("A");
  });

  it("exposes aria-disabled when disabled", () => {
    const { getByRole } = renderWithProviders(<Button disabled>Off</Button>);
    expect(getByRole("button", { name: "Off" })).toBeDisabled();
  });
});

describe("Badge", () => {
  it("renders a tone label and exposes it via aria-label", () => {
    const { getByLabelText } = renderWithProviders(
      <Badge tone="success" aria-label="Status: ok">
        ok
      </Badge>,
    );
    expect(getByLabelText("Status: ok")).toBeInTheDocument();
  });
});

describe("Input + Label", () => {
  it("associates label and input via Radix Label htmlFor", () => {
    const { container } = renderWithProviders(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </>,
    );
    const input = container.querySelector("#email");
    expect(input).not.toBeNull();
    expect(input?.getAttribute("type")).toBe("email");
  });

  it("marks invalid inputs with aria-invalid", () => {
    const { getByRole } = renderWithProviders(
      <Input invalid aria-label="broken" />,
    );
    expect(getByRole("textbox", { name: "broken" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});