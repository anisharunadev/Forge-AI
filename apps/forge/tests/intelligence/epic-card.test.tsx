/**
 * FORA-501 — EpicCard render tests.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EpicCard } from "../../components/intelligence/EpicCard";
import type { Epic } from "../../lib/intelligence/types";

function epicFixture(overrides: Partial<Epic> = {}): Epic {
  return {
    id: "epic-forge-501",
    identifier: "FORA-501",
    title: "Project Intelligence Center",
    status: "active",
    owner: "pm",
    subGoalList: ["goal-forge-ui-spine"],
    successMetric: "PM can manage an Epic end-to-end from this surface.",
    description: "PM-facing typed-artifact browser.",
    storyIds: ["story-forge-501-list"],
    createdAt: "2026-06-19T20:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
    ...overrides,
  };
}

describe("<EpicCard>", () => {
  it("renders the identifier + title + status badge", () => {
    render(<EpicCard epic={epicFixture()} storyCount={3} />);
    const root = screen.getByTestId("epic-row");
    expect(root.getAttribute("data-epic-id")).toBe("epic-forge-501");
    expect(root.getAttribute("data-epic-status")).toBe("active");
    expect(screen.getByTestId("epic-status-badge").getAttribute("data-status")).toBe(
      "active",
    );
    expect(screen.getByTestId("epic-owner").textContent).toBe("pm");
    expect(screen.getByTestId("epic-story-count").textContent).toBe("3");
  });

  it("renders an Open link to the per-epic detail page", () => {
    render(<EpicCard epic={epicFixture()} storyCount={3} />);
    const link = screen.getByTestId("epic-open");
    expect(link.getAttribute("href")).toBe(
      "/project-intelligence/epics/epic-forge-501",
    );
  });

  it("renders the success metric verbatim", () => {
    render(<EpicCard epic={epicFixture()} storyCount={3} />);
    expect(screen.getByTestId("epic-success-metric").textContent).toContain(
      "PM can manage an Epic end-to-end",
    );
  });

  it("marks the card as audit when isAudit is true", () => {
    render(<EpicCard epic={epicFixture()} storyCount={3} isAudit />);
    const root = screen.getByTestId("epic-row");
    expect(root.getAttribute("data-audit")).toBe("true");
  });
});