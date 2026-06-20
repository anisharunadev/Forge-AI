/**
 * FORA-501 — RequirementBriefCard render tests.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequirementBriefCard } from "../../components/intelligence/RequirementBriefCard";
import type { RequirementBrief } from "../../lib/intelligence/types";

function briefFixture(overrides: Partial<RequirementBrief> = {}): RequirementBrief {
  return {
    id: "rb-forge-501",
    epicId: "epic-forge-501",
    title: "Project Intelligence — Requirement Brief",
    schema_version: "1.0",
    source: "FORA-501 description",
    sections: [],
    createdAt: "2026-06-19T20:00:00Z",
    updatedAt: "2026-06-20T17:46:00Z",
    ...overrides,
  };
}

describe("<RequirementBriefCard>", () => {
  it("pins schema_version to '1.0' on the rendered DOM", () => {
    render(<RequirementBriefCard brief={briefFixture()} />);
    const root = screen.getByTestId("requirement-brief");
    expect(root.getAttribute("data-schema-version")).toBe("1.0");
    expect(screen.getByTestId("requirement-brief-schema-version").textContent).toContain(
      "1.0",
    );
  });

  it("renders the section count + open question count", () => {
    render(
      <RequirementBriefCard
        brief={briefFixture({
          sections: [
            {
              key: "mission",
              title: "Mission",
              body: "...",
              openQuestions: [
                {
                  id: "q1",
                  prompt: "Who owns Project Intelligence?",
                  owner: "pm",
                  blocks: [],
                  dueBy: null,
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("requirement-brief-section-count").textContent).toBe("1");
    expect(
      screen.getByTestId("requirement-brief-open-question-count").textContent,
    ).toBe("1");
  });

  it("renders a View-brief link to the per-epic brief anchor", () => {
    render(<RequirementBriefCard brief={briefFixture()} />);
    const link = screen.getByTestId("requirement-brief-open");
    expect(link.getAttribute("href")).toBe(
      "/project-intelligence/epics/epic-forge-501#brief",
    );
  });
});