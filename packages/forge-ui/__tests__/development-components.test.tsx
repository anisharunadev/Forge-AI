/**
 * Component tests for the Development Center panels — Plan 1 §3.7.
 *
 * Verifies the panels render the right DOM, the affordances wire up, the
 * cycle explainer switches state, and the blast-radius panel responds to
 * multi-source selection. Uses the standard `setup.ts` test harness.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdrList } from "../src/development/adr-list";
import { BlastRadiusPanel } from "../src/development/blast-radius-panel";
import { CycleExplainerPanel } from "../src/development/cycle-explainer-panel";
import { DevelopmentFilters } from "../src/development/development-filters";
import { InFlightPatches } from "../src/development/in-flight-patches";
import { PrQueue } from "../src/development/pr-queue";
import { ShowInGraph } from "../src/development/show-in-graph";
import type { AdrRegistryEntry, DependencyCycle, PrReviewRecord } from "../src/development/development";
import type { Patch } from "../src/typed-artifacts/types";
import type { DependencyEdge, DependencyNode } from "../src/graph/nodes";

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
  files: [{ path: "packages/forge-ui/src/graph/provider.ts", additions: 10, deletions: 2, hunks: [] }],
  linkedPrs: [{ id: "100", url: "https://example/100", state: "open" }],
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

const CYCLE: DependencyCycle = {
  id: "cy-1",
  modules: ["a.tsx", "b.tsx", "a.tsx"],
  reason: "a imports b imports a",
};

function makeModule(id: string): DependencyNode {
  return { id, family: "dependency", kind: "module", label: id, modulePath: id };
}
const MODULES: ReadonlyArray<DependencyNode> = [
  makeModule("a.tsx"),
  makeModule("b.tsx"),
  makeModule("c.tsx"),
];
const EDGES: ReadonlyArray<DependencyEdge> = [
  { id: "a->b", source: "a.tsx", target: "b.tsx", kind: "imports" },
  { id: "b->c", source: "b.tsx", target: "c.tsx", kind: "imports" },
];

describe("AdrList", () => {
  it("renders compact rows with status + show-in-graph affordance", () => {
    render(<AdrList entries={ADRS} variant="compact" onNavigate={() => {}} />);
    expect(screen.getByTestId("adr-list-compact")).toBeInTheDocument();
    expect(screen.getByTestId("adr-compact-0001")).toBeInTheDocument();
    expect(screen.getByTestId("adr-compact-0002")).toBeInTheDocument();
    expect(screen.getByTestId("show-in-graph-architecture-adr-0001")).toBeInTheDocument();
  });

  it("renders detail panels with show-in-graph affordance", () => {
    render(<AdrList entries={ADRS} variant="detail" onNavigate={() => {}} />);
    expect(screen.getByTestId("adr-list-detail")).toBeInTheDocument();
    expect(screen.getByTestId("adr-detail-0001")).toBeInTheDocument();
  });

  it("shows the empty state when no entries", () => {
    render(<AdrList entries={[]} variant="compact" />);
    expect(screen.getByTestId("adr-list-empty")).toBeInTheDocument();
  });

  it("sorts entries by number desc", () => {
    render(<AdrList entries={ADRS} variant="compact" />);
    const list = screen.getByTestId("adr-list-compact");
    const ids = list.querySelectorAll('[data-testid^="adr-compact-"]');
    expect(ids[0]?.getAttribute("data-testid")).toBe("adr-compact-0002");
    expect(ids[1]?.getAttribute("data-testid")).toBe("adr-compact-0001");
  });
});

describe("ShowInGraph", () => {
  it("emits a navigate event when clicked", async () => {
    const onNavigate = vi.fn();
    render(
      <ShowInGraph
        target={{ canvas: "architecture", nodeId: "adr-1" }}
        onNavigate={onNavigate}
      />,
    );
    await userEvent.click(screen.getByTestId("show-in-graph-architecture-adr-1"));
    expect(onNavigate).toHaveBeenCalledWith({ canvas: "architecture", nodeId: "adr-1" });
  });
});

describe("InFlightPatches", () => {
  it("renders the patches via PatchRenderer", () => {
    render(<InFlightPatches patches={[PATCH]} onNavigate={() => {}} />);
    expect(screen.getByTestId("in-flight-patches")).toBeInTheDocument();
    expect(screen.getByTestId("in-flight-patch-p-1")).toBeInTheDocument();
  });

  it("toggles between summary and panel (diff) variants", async () => {
    render(<InFlightPatches patches={[PATCH]} onNavigate={() => {}} />);
    await userEvent.click(screen.getByTestId("in-flight-patch-toggle-p-1"));
    // After toggle, the button label flips.
    expect(screen.getByTestId("in-flight-patch-toggle-p-1").textContent).toBe("Hide diff");
  });

  it("renders the empty state when no patches", () => {
    render(<InFlightPatches patches={[]} />);
    expect(screen.getByTestId("in-flight-patches-empty")).toBeInTheDocument();
  });
});

describe("PrQueue", () => {
  it("renders a row per PR with state + review badges", () => {
    render(<PrQueue records={PRS} onOpenPr={() => {}} />);
    expect(screen.getByTestId("pr-queue")).toBeInTheDocument();
    expect(screen.getByTestId("pr-queue-row-100")).toBeInTheDocument();
  });

  it("emits onOpenPr when the row button is clicked", async () => {
    const onOpenPr = vi.fn();
    render(<PrQueue records={PRS} onOpenPr={onOpenPr} />);
    await userEvent.click(screen.getByLabelText("Open PR 100: Add typed graph"));
    expect(onOpenPr).toHaveBeenCalledWith(PRS[0]);
  });

  it("shows the empty state when no PRs", () => {
    render(<PrQueue records={[]} />);
    expect(screen.getByTestId("pr-queue-empty")).toBeInTheDocument();
  });
});

describe("CycleExplainerPanel", () => {
  it("shows the empty state when no cycle", () => {
    render(<CycleExplainerPanel cycle={null} />);
    expect(screen.getByTestId("cycle-explainer-empty")).toBeInTheDocument();
  });

  it("renders modules + reason when a cycle is selected", () => {
    render(<CycleExplainerPanel cycle={CYCLE} onClose={() => {}} />);
    expect(screen.getByTestId("cycle-explainer-cy-1")).toBeInTheDocument();
    expect(screen.getByText("a imports b imports a")).toBeInTheDocument();
  });

  it("emits onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<CycleExplainerPanel cycle={CYCLE} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close cycle explainer"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("BlastRadiusPanel", () => {
  it("shows the empty state when no sources", () => {
    render(<BlastRadiusPanel sources={[]} nodes={MODULES} edges={EDGES} />);
    expect(screen.getByTestId("blast-radius-empty")).toBeInTheDocument();
  });

  it("computes reachable modules and shows counts", () => {
    render(<BlastRadiusPanel sources={["a.tsx"]} nodes={MODULES} edges={EDGES} />);
    expect(screen.getByTestId("blast-radius")).toBeInTheDocument();
    expect(screen.getByText("2 modules reachable")).toBeInTheDocument();
    expect(screen.getByText("b.tsx")).toBeInTheDocument();
    expect(screen.getByText("c.tsx")).toBeInTheDocument();
  });
});

describe("DevelopmentFilters", () => {
  it("renders all filter axes", () => {
    render(
      <DevelopmentFilters
        value={{}}
        owners={[]}
        packages={[]}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByTestId("development-filters")).toBeInTheDocument();
    expect(screen.getByTestId("dev-filter-adr-accepted")).toBeInTheDocument();
    expect(screen.getByTestId("dev-filter-no-tests")).toBeInTheDocument();
    expect(screen.getByTestId("dev-filter-reset")).toBeInTheDocument();
  });

  it("emits onChange with the toggled status", async () => {
    const onChange = vi.fn();
    render(
      <DevelopmentFilters
        value={{}}
        owners={[]}
        packages={[]}
        onChange={onChange}
        onReset={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId("dev-filter-adr-accepted"));
    expect(onChange).toHaveBeenCalledWith({ adrStatuses: ["accepted"] });
  });

  it("emits onReset when the reset button is clicked", async () => {
    const onReset = vi.fn();
    render(
      <DevelopmentFilters
        value={{ adrStatuses: ["accepted"] }}
        owners={[]}
        packages={[]}
        onChange={() => {}}
        onReset={onReset}
      />,
    );
    await userEvent.click(screen.getByTestId("dev-filter-reset"));
    expect(onReset).toHaveBeenCalled();
  });
});
