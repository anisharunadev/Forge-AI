import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { AdrRenderer } from "../src/typed-artifacts/adr";
import { TaskRenderer } from "../src/typed-artifacts/task";

describe("AdrRenderer", () => {
  it("renders ADR number, title, status, and decision context", () => {
    const { getByRole, getByText } = renderWithProviders(
      <AdrRenderer
        artifact={{
          id: "adr-1",
          number: "0042",
          title: "Adopt pgvector",
          status: "accepted",
          decisionDate: "2026-06-15",
          deciders: ["CTO", "Architect"],
          context: "We need a vector store for v1.",
          decision: "Use pgvector in primary Postgres.",
          consequences: "One fewer service to operate.",
        }}
      />,
    );
    expect(getByRole("heading", { name: /Adopt pgvector/ })).toBeInTheDocument();
    expect(getByText("ADR-0042")).toBeInTheDocument();
    expect(getByText(/Decided 2026-06-15/)).toBeInTheDocument();
    expect(getByText("We need a vector store for v1.")).toBeInTheDocument();
  });
});

describe("TaskRenderer", () => {
  it("shows identifier, status, priority, owner, and blockers", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <TaskRenderer
        artifact={{
          id: "t-1",
          identifier: "FORA-482",
          title: "@fora/forge-ui package skeleton",
          status: "in_progress",
          priority: "medium",
          owner: { id: "u-1", displayName: "CTO" },
          blockedBy: ["FORA-200"],
        }}
      />,
    );
    expect(getByText("FORA-482")).toBeInTheDocument();
    expect(getByText(/@fora\/forge-ui package skeleton/)).toBeInTheDocument();
    expect(getByText("Owner:")).toBeInTheDocument();
    expect(getByText(/Blocked by:/)).toBeInTheDocument();
    expect(getByLabelText("Priority: medium")).toBeInTheDocument();
  });
});