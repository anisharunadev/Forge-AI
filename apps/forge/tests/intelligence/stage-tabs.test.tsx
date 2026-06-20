/**
 * FORA-501 — StageTabs tests (Plan 1 §4 cross-reference matrix).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageTabs } from "../../components/intelligence/StageTabs";
import type { Story } from "../../lib/intelligence/types";

function storyFixture(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-x",
    identifier: "FORA-X",
    epicId: "epic-x",
    title: "Stage tabs story",
    acceptanceCriteria: [],
    status: "dev",
    priority: "high",
    owner: "pm",
    blockedBy: [],
    blocks: [],
    risk: null,
    handoffContractIds: [],
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
    ...overrides,
  };
}

describe("<StageTabs>", () => {
  it("renders the three stage tabs (Dev, QA, DevOps)", () => {
    render(<StageTabs stories={[storyFixture()]} active="dev" />);
    const tabs = screen.getAllByTestId("stage-tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.getAttribute("data-stage"))).toEqual([
      "dev",
      "qa",
      "devops",
    ]);
    expect(tabs[0]!.getAttribute("data-active")).toBe("true");
  });

  it("filters the story list by the active stage", () => {
    const stories = [
      storyFixture({ id: "s1", status: "dev" }),
      storyFixture({ id: "s2", status: "qa" }),
      storyFixture({ id: "s3", status: "devops" }),
    ];
    render(<StageTabs stories={stories} active="qa" />);
    const panel = screen.getByTestId("stage-tab-panel");
    expect(panel.getAttribute("data-stage")).toBe("qa");
    const list = screen.getByTestId("stage-tab-list");
    expect(list.getAttribute("data-story-count")).toBe("1");
  });

  it("renders the empty-state when no stories match", () => {
    render(<StageTabs stories={[]} active="devops" />);
    const empty = screen.getByTestId("stage-tab-empty");
    expect(empty.getAttribute("data-empty-kind")).toBe("no-stories");
  });

  it("shows the right drill-down hint for the active stage", () => {
    render(<StageTabs stories={[]} active="dev" />);
    expect(screen.getByTestId("stage-tab-drill-hint").textContent).toContain(
      "Development Center",
    );
  });
});