import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { LineChart } from "../src/charts/line-chart";
import { BarChart } from "../src/charts/bar-chart";
import { StackedAreaChart } from "../src/charts/stacked-area-chart";
import { Heatmap } from "../src/charts/heatmap";
import { Sparkline } from "../src/charts/sparkline";

describe("LineChart", () => {
  it("renders a title + accessible table fallback", () => {
    const { getByText, container } = renderWithProviders(
      <LineChart
        title="Cost over time"
        caption="Cost trend across two weeks"
        data={[
          { x: "2026-06-01", cost: 10, tokens: 500 },
          { x: "2026-06-02", cost: 12, tokens: 600 },
        ]}
        series={[
          { key: "cost", label: "Cost (USD)" },
          { key: "tokens", label: "Tokens" },
        ]}
      />,
    );
    expect(getByText("Cost over time")).toBeInTheDocument();
    // sr-only caption still in the DOM.
    const sr = container.querySelector(".sr-only");
    expect(sr?.textContent).toContain("Cost trend across two weeks");
    // Fallback table summary reachable.
    expect(getByText("Show data table")).toBeInTheDocument();
  });
});

describe("BarChart", () => {
  it("renders rows for each datum label", () => {
    const { getByText } = renderWithProviders(
      <BarChart
        title="Calls by MCP"
        data={[
          { label: "Jira", calls: 42 },
          { label: "GitHub", calls: 17 },
        ]}
        series={[{ key: "calls", label: "Calls" }]}
      />,
    );
    expect(getByText("Calls by MCP")).toBeInTheDocument();
    expect(getByText("Jira")).toBeInTheDocument();
    expect(getByText("GitHub")).toBeInTheDocument();
  });
});

describe("StackedAreaChart", () => {
  it("renders caption + a fallback table summary", () => {
    const { getByText } = renderWithProviders(
      <StackedAreaChart
        title="Cumulative cost"
        data={[
          { x: "Mon", junior: 5, senior: 3 },
          { x: "Tue", junior: 6, senior: 4 },
        ]}
        series={[
          { key: "junior", label: "Junior" },
          { key: "senior", label: "Senior" },
        ]}
      />,
    );
    expect(getByText("Cumulative cost")).toBeInTheDocument();
    expect(getByText("Show data table")).toBeInTheDocument();
  });
});

describe("Heatmap", () => {
  it("renders a cell per (row, column) pair + accessible fallback", () => {
    const { getAllByText, container } = renderWithProviders(
      <Heatmap
        title="Eval matrix"
        domain={[0, 100]}
        cells={[
          { row: "T1", column: "Q1", value: 50 },
          { row: "T1", column: "Q2", value: 90 },
        ]}
      />,
    );
    // "T1" appears both as the row label in the grid and as a cell in the
    // accessible data table; assert at least one occurrence.
    expect(getAllByText("T1").length).toBeGreaterThan(0);
    expect(getAllByText("Q1").length).toBeGreaterThan(0);
    // 2 colored cells in the grid (one per row,column pair).
    const cells = container.querySelectorAll("td[title]");
    expect(cells.length).toBe(2);
    expect(getAllByText("Show data table").length).toBeGreaterThan(0);
  });
});

describe("Sparkline", () => {
  it("exposes the percentage delta in the aria-label", () => {
    const { container } = renderWithProviders(<Sparkline values={[10, 20, 30, 40]} label="up" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toMatch(/\+300%/);
  });

  it("renders an em-dash placeholder when too few points", () => {
    const { container } = renderWithProviders(<Sparkline values={[42]} />);
    expect(container.textContent).toContain("—");
  });
});
