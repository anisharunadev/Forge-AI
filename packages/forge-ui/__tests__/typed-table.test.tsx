import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { TypedTable, TypedTableToolbar, TypedTableEmptyState, toCsv } from "../src/lists/typed-table";
import { fireEvent, screen } from "@testing-library/react";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
}

const sample: ReadonlyArray<Row> = [
  { id: "1", name: "alpha", cost: 10 },
  { id: "2", name: "beta", cost: 25 },
  { id: "3", name: "gamma", cost: 5 },
];

const cols = [
  { id: "id", header: "ID" },
  { id: "name", header: "Name" },
  { id: "cost", header: "Cost", numeric: true },
];

describe("TypedTable", () => {
  it("renders every row + every header", () => {
    const { getByRole, getByText } = renderWithProviders(
      <TypedTable data={sample} columns={cols} ariaLabel="Test table" />,
    );
    expect(getByRole("table", { name: "Test table" })).toBeInTheDocument();
    for (const r of sample) {
      expect(getByText(r.name)).toBeInTheDocument();
    }
  });

  it("sorts when a sortable header is clicked", () => {
    const { getByRole } = renderWithProviders(
      <TypedTable data={sample} columns={cols} ariaLabel="Sort test" />,
    );
    // Use the button inside the header (not the text node, which becomes
    // ambiguous after the sort indicator is appended).
    const costButton = getByRole("button", { name: /^Cost/ });
    // TanStack's getToggleSortingHandler cycles desc → asc → none on
    // sortable columns. First click → desc: rows become beta(25),
    // alpha(10), gamma(5). Second click → asc: rows become gamma(5),
    // alpha(10), beta(25).
    fireEvent.click(costButton);
    let table = getByRole("table", { name: "Sort test" });
    let bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(3);
    let firstRowName = bodyRows[0]?.querySelectorAll("td")[1]?.textContent ?? "";
    expect(firstRowName).toBe("beta");
    let lastRowName = bodyRows[bodyRows.length - 1]?.querySelectorAll("td")[1]?.textContent ?? "";
    expect(lastRowName).toBe("gamma");

    fireEvent.click(getByRole("button", { name: /^Cost/ }));
    table = getByRole("table", { name: "Sort test" });
    bodyRows = table.querySelectorAll("tbody tr");
    firstRowName = bodyRows[0]?.querySelectorAll("td")[1]?.textContent ?? "";
    expect(firstRowName).toBe("gamma");
    lastRowName = bodyRows[bodyRows.length - 1]?.querySelectorAll("td")[1]?.textContent ?? "";
    expect(lastRowName).toBe("beta");
  });

  it("shows TypedTableEmptyState when data is empty (via toolbar)", () => {
    const { rerender } = renderWithProviders(
      <>
        <TypedTable data={[]} columns={cols} ariaLabel="Empty" />
        <TypedTableEmptyState />
      </>,
    );
    expect(screen.getAllByText("No rows to display.").length).toBeGreaterThanOrEqual(1);
    rerender(<TypedTableToolbar query="" onQueryChange={() => undefined} />);
  });

  it("toCsv escapes commas and quotes per RFC 4180", () => {
    const csv = toCsv(
      [{ id: "1", name: 'Hello, "world"', cost: 1 }],
      [
        { id: "id", header: "ID" },
        { id: "name", header: "Name" },
        { id: "cost", header: "Cost" },
      ],
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("ID,Name,Cost");
    expect(lines[1]).toBe('1,"Hello, ""world""",1');
  });

  it("TypedTableToolbar renders a search input wired to onQueryChange", () => {
    let captured = "";
    renderWithProviders(
      <TypedTableToolbar
        query={captured}
        onQueryChange={(v) => {
          captured = v;
        }}
      />,
    );
    const input = screen.getByLabelText("Filter rows") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alpha" } });
    expect(captured).toBe("alpha");
  });
});
