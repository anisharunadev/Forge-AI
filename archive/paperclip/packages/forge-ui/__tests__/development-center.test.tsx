/**
 * Component tests for the Development Center composer — Plan 1 §3.7.
 *
 * Verifies the composer wires the panels together: filter axes narrow the
 * ADR list, the canvas tabs switch the active canvas, the cycle buttons
 * surface the explainer, the show-in-graph affordance emits navigate
 * events. No provider is required for the list-only state machine.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevelopmentCenter } from "../src/development/development-center";
import type { AdrRegistryEntry, DependencyCycle, PrReviewRecord } from "../src/development/development";
import type { Patch } from "../src/typed-artifacts/types";

const ADRS: ReadonlyArray<AdrRegistryEntry> = [
  { number: "0001", title: "Typed graph", path: "a.md", status: "accepted", date: "2026-06-17", architectureArea: "ui" },
  { number: "0002", title: "Subpaths", path: "b.md", status: "proposed", date: "2026-06-20", architectureArea: "ui" },
];

const PATCH: Patch = {
  id: "p-1",
  title: "Sample patch",
  summary: "Adds the typed graph provider contract.",
  additions: 10,
  deletions: 2,
  filesChanged: 1,
};

const PRS: ReadonlyArray<PrReviewRecord> = [
  {
    id: "pr-100",
    prNumber: "100",
    url: "https://example/100",
    title: "Add typed graph",
    author: { displayName: "Senior Engineer", id: "agent-1" },
    state: "open",
    reviewState: "pending",
    linesAdded: 10,
    linesDeleted: 2,
    filesChanged: 1,
    updatedAt: "2026-06-20T12:00:00Z",
  },
];

const CYCLES: ReadonlyArray<DependencyCycle> = [
  { id: "cy-1", modules: ["a.tsx", "b.tsx", "a.tsx"], reason: "a imports b imports a" },
];

describe("DevelopmentCenter", () => {
  it("renders all panels with the default fixtures", () => {
    render(
      <DevelopmentCenter
        adrs={ADRS}
        patches={[PATCH]}
        pullRequests={PRS}
        cycles={CYCLES}
      />,
    );
    expect(screen.getByTestId("development-center")).toBeInTheDocument();
    // 4 from typed-artifacts: detail list = 2
    expect(screen.getAllByTestId(/^adr-detail-/)).toHaveLength(2);
    expect(screen.getByTestId("in-flight-patches")).toBeInTheDocument();
    expect(screen.getByTestId("pr-queue")).toBeInTheDocument();
  });

  it("switches active canvas via the tabs", async () => {
    render(<DevelopmentCenter adrs={ADRS} patches={[]} pullRequests={[]} cycles={[]} />);
    expect(screen.getByTestId("canvas-host-dependency")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("canvas-tab-architecture"));
    expect(screen.getByTestId("canvas-host-architecture")).toBeInTheDocument();
  });

  it("opens the cycle explainer when a cycle button is pressed", async () => {
    render(
      <DevelopmentCenter
        adrs={ADRS}
        patches={[]}
        pullRequests={[]}
        cycles={CYCLES}
      />,
    );
    expect(screen.getByTestId("cycle-explainer-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("cycle-button-cy-1"));
    expect(screen.getByTestId("cycle-explainer-cy-1")).toBeInTheDocument();
  });

  it("emits navigate events from the show-in-graph affordance", async () => {
    const onNavigate = vi.fn();
    render(
      <DevelopmentCenter
        adrs={ADRS}
        patches={[]}
        pullRequests={[]}
        cycles={[]}
        onNavigate={onNavigate}
      />,
    );
    await userEvent.click(screen.getByTestId("show-in-graph-architecture-adr-0001"));
    expect(onNavigate).toHaveBeenCalledWith({
      canvas: "architecture",
      nodeId: "adr-0001",
    });
  });

  it("filters the ADR list when the filter status buttons are pressed", async () => {
    render(
      <DevelopmentCenter
        adrs={ADRS}
        patches={[]}
        pullRequests={[]}
        cycles={[]}
      />,
    );
    // Initially both ADRs visible.
    expect(screen.getAllByTestId(/^adr-detail-/)).toHaveLength(2);
    // Toggle 'accepted' on — only 0001 should remain.
    await userEvent.click(screen.getByTestId("dev-filter-adr-accepted"));
    expect(screen.getAllByTestId(/^adr-detail-/)).toHaveLength(1);
    expect(screen.getByTestId("adr-detail-0001")).toBeInTheDocument();
  });

  it("shows the cycle list only when cycles are provided", () => {
    const { rerender } = render(
      <DevelopmentCenter adrs={ADRS} patches={[]} pullRequests={[]} cycles={[]} />,
    );
    expect(screen.queryByTestId("cycle-button-cy-1")).not.toBeInTheDocument();
    rerender(
      <DevelopmentCenter adrs={ADRS} patches={[]} pullRequests={[]} cycles={CYCLES} />,
    );
    expect(screen.getByTestId("cycle-button-cy-1")).toBeInTheDocument();
  });
});
