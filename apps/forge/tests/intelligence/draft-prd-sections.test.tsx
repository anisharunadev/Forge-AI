/**
 * FORA-501 — DraftPrdView (AC #1) renders all 11 PRD sections.
 *
 * Uses an inline fixture instead of importing from the orchestrator
 * stub; the components are tested in isolation against a known shape.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DraftPrdView } from "../../components/intelligence/DraftPrdView";
import { REQUIREMENT_BRIEF_SECTIONS } from "../../lib/intelligence/types";
import type { DraftPrd } from "../../lib/intelligence/types";

const fixturePrd: DraftPrd = {
  id: "prd-test-001",
  epicId: "epic-test-001",
  title: "Test PRD",
  markdown: "# Test PRD\n\n## Mission\n\nBuild Forge AI.",
  lintPassed: true,
  sectionBodies: REQUIREMENT_BRIEF_SECTIONS.reduce(
    (acc, key) => {
      acc[key] = `Body for ${key}.`;
      return acc;
    },
    {} as Record<(typeof REQUIREMENT_BRIEF_SECTIONS)[number], string>,
  ),
  createdAt: "2026-06-20T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
};

describe("<DraftPrdView>", () => {
  it("renders the lint-passed badge + the canonical section count", () => {
    render(<DraftPrdView prd={fixturePrd} />);
    const root = screen.getByTestId("draft-prd");
    expect(root.getAttribute("data-section-count")).toBe(
      String(REQUIREMENT_BRIEF_SECTIONS.length),
    );
    expect(root.getAttribute("data-lint-passed")).toBe("true");
    expect(screen.getByTestId("draft-prd-lint").textContent).toContain(
      "lint-passed",
    );
  });

  it("renders all 11 canonical PRD sections in order (FORA-501 AC #1)", () => {
    render(<DraftPrdView prd={fixturePrd} />);
    const sections = screen.getAllByTestId("draft-prd-section");
    expect(sections).toHaveLength(REQUIREMENT_BRIEF_SECTIONS.length);
    sections.forEach((el, i) => {
      expect(el.getAttribute("data-section-key")).toBe(REQUIREMENT_BRIEF_SECTIONS[i]);
      expect(el.getAttribute("data-section-index")).toBe(String(i + 1));
    });
  });

  it("renders the typed section body from prd.sectionBodies, not the markdown", () => {
    render(<DraftPrdView prd={fixturePrd} />);
    const mission = screen
      .getAllByTestId("draft-prd-section")
      .find((el) => el.getAttribute("data-section-key") === "mission");
    expect(mission).toBeDefined();
    const missionSection = within(mission!).getByText(/Body for mission/);
    expect(missionSection).toBeTruthy();
  });
});