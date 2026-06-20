/**
 * FORA-501 — StoryCard render tests, including drill-down target.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryCard } from "../../components/intelligence/StoryCard";
import type { Story } from "../../lib/intelligence/types";

function storyFixture(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-forge-501-list",
    identifier: "FORA-501.list",
    epicId: "epic-forge-501",
    title: "Project Intelligence — Epic + Story lists",
    acceptanceCriteria: ["TypedTable renders with sort/filter/pagination."],
    status: "dev",
    priority: "high",
    owner: "pm",
    blockedBy: [],
    blocks: [],
    risk: null,
    handoffContractIds: [],
    createdAt: "2026-06-20T10:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
    ...overrides,
  };
}

describe("<StoryCard>", () => {
  it("renders status + priority + open link", () => {
    render(<StoryCard story={storyFixture()} />);
    const root = screen.getByTestId("story-row");
    expect(root.getAttribute("data-story-status")).toBe("dev");
    expect(root.getAttribute("data-story-priority")).toBe("high");
    const open = screen.getByTestId("story-open");
    expect(open.getAttribute("href")).toBe(
      "/project-intelligence/stories/story-forge-501-list",
    );
  });

  it("renders the drill-down CTA into the Development Center when status=dev", () => {
    render(<StoryCard story={storyFixture({ status: "dev" })} />);
    const drill = screen.getByTestId("story-drill-down");
    expect(drill.getAttribute("data-drill-target")).toBe("dev");
    expect(drill.getAttribute("href")).toBe(
      "/development-center?story=FORA-501.list",
    );
  });

  it("renders the drill-down CTA into the Testing Center when status=qa", () => {
    render(<StoryCard story={storyFixture({ status: "qa" })} />);
    const drill = screen.getByTestId("story-drill-down");
    expect(drill.getAttribute("data-drill-target")).toBe("qa");
    expect(drill.getAttribute("href")).toBe(
      "/testing-center?story=FORA-501.list",
    );
  });

  it("renders the drill-down CTA into the Deployment Center when status=devops", () => {
    render(<StoryCard story={storyFixture({ status: "devops" })} />);
    const drill = screen.getByTestId("story-drill-down");
    expect(drill.getAttribute("data-drill-target")).toBe("devops");
    expect(drill.getAttribute("href")).toBe(
      "/deployment-center?story=FORA-501.list",
    );
  });

  it("omits the drill-down CTA when the story is not in a stage center", () => {
    render(<StoryCard story={storyFixture({ status: "done" })} />);
    expect(screen.queryByTestId("story-drill-down")).toBeNull();
  });

  it("renders the risk warning when risk is set", () => {
    render(
      <StoryCard
        story={storyFixture({ risk: "Schema version must match exactly." })}
      />,
    );
    expect(screen.getByTestId("story-risk").textContent).toContain(
      "Schema version must match exactly.",
    );
  });

  it("omits the risk warning when risk is null", () => {
    render(<StoryCard story={storyFixture({ risk: null })} />);
    expect(screen.queryByTestId("story-risk")).toBeNull();
  });
});