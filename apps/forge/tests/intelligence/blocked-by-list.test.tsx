/**
 * FORA-501 — BlockedByList tests.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockedByList } from "../../components/intelligence/BlockedByList";

describe("<BlockedByList>", () => {
  it("renders the empty chips when both lists are empty", () => {
    render(<BlockedByList blockedBy={[]} blocks={[]} />);
    expect(screen.getByTestId("blocked-by-empty").textContent).toContain("none");
    expect(screen.getByTestId("blocks-empty").textContent).toContain("none");
  });

  it("renders one chip per blocked-by and per blocks entry", () => {
    const resolver = (id: string) => `LABEL:${id}`;
    render(
      <BlockedByList
        blockedBy={["story-forge-393-1", "story-forge-393-2"]}
        blocks={["story-forge-501-list"]}
        resolveIdentifier={resolver}
      />,
    );
    const blocked = screen.getAllByTestId("blocked-by-chip");
    expect(blocked).toHaveLength(2);
    expect(blocked.map((el) => el.getAttribute("data-blocked-id"))).toEqual([
      "story-forge-393-1",
      "story-forge-393-2",
    ]);
    expect(blocked.map((el) => el.textContent)).toEqual([
      "LABEL:story-forge-393-1",
      "LABEL:story-forge-393-2",
    ]);
    const blocks = screen.getAllByTestId("blocks-chip");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.textContent).toBe("LABEL:story-forge-501-list");
  });

  it("renders the raw id when no resolver is passed", () => {
    render(
      <BlockedByList blockedBy={["story-forge-393-1"]} blocks={[]} />,
    );
    expect(screen.getByTestId("blocked-by-chip").textContent).toBe(
      "story-forge-393-1",
    );
  });

  it("points chips at the per-story detail page", () => {
    render(<BlockedByList blockedBy={["story-forge-501-list"]} blocks={[]} />);
    const chip = screen.getByTestId("blocked-by-chip");
    expect(chip.getAttribute("href")).toBe(
      "/project-intelligence/stories/story-forge-501-list",
    );
  });
});