/**
 * FORA-501 — DraftPrdView (AC #1) renders all 11 PRD sections.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DraftPrdView } from "../../components/intelligence/DraftPrdView";
import { listDraftPrds } from "../../lib/intelligence/mock-data";
import { REQUIREMENT_BRIEF_SECTIONS } from "../../lib/intelligence/types";

describe("<DraftPrdView>", () => {
  it("renders the lint-passed badge + the canonical section count", () => {
    const prd = listDraftPrds()[0]!;
    render(<DraftPrdView prd={prd} />);
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
    const prd = listDraftPrds()[0]!;
    render(<DraftPrdView prd={prd} />);
    const sections = screen.getAllByTestId("draft-prd-section");
    expect(sections).toHaveLength(REQUIREMENT_BRIEF_SECTIONS.length);
    sections.forEach((el, i) => {
      expect(el.getAttribute("data-section-key")).toBe(REQUIREMENT_BRIEF_SECTIONS[i]);
      expect(el.getAttribute("data-section-index")).toBe(String(i + 1));
    });
  });

  it("renders the typed section body from prd.sectionBodies, not the markdown", () => {
    const prd = listDraftPrds()[0]!;
    render(<DraftPrdView prd={prd} />);
    const mission = screen
      .getAllByTestId("draft-prd-section")
      .find((el) => el.getAttribute("data-section-key") === "mission");
    expect(mission).toBeDefined();
    const missionSection = within(mission!).getByText(/Build Forge AI/);
    expect(missionSection).toBeTruthy();
  });
});