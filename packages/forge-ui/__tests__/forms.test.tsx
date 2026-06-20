import { describe, it, expect } from "vitest";
import { z } from "zod";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { useTypedForm } from "../src/forms/use-typed-form";
import { TypedFormField } from "../src/forms/typed-form-field";
import { TypedFormSection } from "../src/forms/typed-form-section";
import { Input } from "../src/primitives/input";
import { Button } from "../src/primitives/button";
import { act, fireEvent, screen } from "@testing-library/react";

const RenameSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
});

function RenameForm({ onSubmit }: { onSubmit: (v: z.infer<typeof RenameSchema>) => void }) {
  const form = useTypedForm(RenameSchema, { title: "" });
  return (
    <form
      onSubmit={form.handleSubmit((v) => {
        onSubmit(v);
      })}
    >
      <TypedFormSection title="Identity">
        <TypedFormField name="title" label="Title" required error={form.formState.errors.title?.message}>
          <Input {...form.register("title")} aria-invalid={!!form.formState.errors.title} />
        </TypedFormField>
      </TypedFormSection>
      <Button type="submit">Save</Button>
    </form>
  );
}

describe("useTypedForm + TypedFormField + TypedFormSection", () => {
  it("rounds-trips a Zod schema: rejects short titles and accepts valid ones", async () => {
    const captured: Array<z.infer<typeof RenameSchema>> = [];
    renderWithProviders(<RenameForm onSubmit={(v) => captured.push(v)} />);

    const input = screen.getByLabelText(/Title/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    // Schema rejects "ab" (less than 3 chars); submission never fires.
    // Validation message should appear after onTouched mode.
    fireEvent.blur(input);
    // No submit yet — captured empty.
    expect(captured).toHaveLength(0);

    fireEvent.change(input, { target: { value: "Forge UI v0.2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(captured).toEqual([{ title: "Forge UI v0.2" }]);
  });

  it("TypedFormSection renders a <fieldset> + <legend>", () => {
    const { container } = renderWithProviders(
      <TypedFormSection title="Identity" description="What to call this.">
        <span>child</span>
      </TypedFormSection>,
    );
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    const legend = container.querySelector("legend");
    expect(legend?.textContent).toBe("Identity");
  });

  it("TypedFormField renders label + (optional) help + error and wires aria-describedby", () => {
    const { container, getByText, getAllByRole } = renderWithProviders(
      <TypedFormField name="x" label="X" helpText="helper" error="bad">
        <Input id="x" />
      </TypedFormField>,
      { withoutLiveRegion: true },
    );
    expect(getByText("X")).toBeInTheDocument();
    expect(getByText("helper")).toBeInTheDocument();
    const alerts = getAllByRole("alert");
    expect(alerts.some((a) => a.textContent === "bad")).toBe(true);
    const input = container.querySelector("#x");
    expect(input?.getAttribute("aria-describedby")).toContain("x-help");
    expect(input?.getAttribute("aria-describedby")).toContain("x-error");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
  });
});
