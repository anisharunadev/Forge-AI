/**
 * FORA-501 — HandoffContractViewer render tests.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HandoffContractViewer } from "../../components/intelligence/HandoffContractViewer";
import type { HandoffContract } from "../../lib/intelligence/types";

function contractFixture(
  overrides: Partial<HandoffContract> = {},
): HandoffContract {
  return {
    id: "hc-fora-501-brief",
    storyId: "story-forge-501-brief",
    version: "1.0.0",
    fromStage: "dev",
    toStage: "qa",
    steps: [
      {
        fromStage: "dev",
        toStage: "qa",
        artefactRef: "apps/forge/lib/intelligence/parser.ts",
        sha256: "sha256:placeholder",
      },
    ],
    inputSchemaRef: "schemas/intelligence/requirement-brief.in.json",
    outputSchemaRef: "schemas/intelligence/requirement-brief.out.json",
    exampleRef: "examples/intelligence/requirement-brief.json",
    sla: { p50Ms: 25, p99Ms: 60, maxRetries: 2 },
    createdAt: "2026-06-20T17:00:00Z",
    ...overrides,
  };
}

describe("<HandoffContractViewer>", () => {
  it("renders the stage envelope and version", () => {
    render(<HandoffContractViewer contract={contractFixture()} />);
    const root = screen.getByTestId("handoff-contract");
    expect(root.getAttribute("data-from-stage")).toBe("dev");
    expect(root.getAttribute("data-to-stage")).toBe("qa");
    expect(root.getAttribute("data-version")).toBe("1.0.0");
  });

  it("renders one step per handoff step", () => {
    render(
      <HandoffContractViewer
        contract={contractFixture({
          steps: [
            {
              fromStage: "architect",
              toStage: "dev",
              artefactRef: "a.ts",
            },
            {
              fromStage: "dev",
              toStage: "qa",
              artefactRef: "b.ts",
            },
          ],
        })}
      />,
    );
    const steps = screen.getAllByTestId("handoff-contract-step");
    expect(steps).toHaveLength(2);
    expect(
      screen.getByTestId("handoff-contract-steps").getAttribute("data-step-count"),
    ).toBe("2");
  });

  it("renders the SLA triplet", () => {
    render(<HandoffContractViewer contract={contractFixture()} />);
    expect(screen.getByTestId("handoff-contract-p50").textContent).toBe("25 ms");
    expect(screen.getByTestId("handoff-contract-p99").textContent).toBe("60 ms");
    expect(screen.getByTestId("handoff-contract-retries").textContent).toBe("2");
  });
});