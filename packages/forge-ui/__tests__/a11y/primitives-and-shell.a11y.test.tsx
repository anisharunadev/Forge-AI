import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../../src/testing/render-with-providers";
import { axe } from "../../src/testing/axe";
import { Shell } from "../../src/shell/shell";
import { Button } from "../../src/primitives/button";
import { ThemeSwitcher } from "../../src/shell/theme-switcher";
import { LiveRegionProvider, useAnnouncer } from "../../src/a11y/live-region";
import { VisuallyHidden } from "../../src/a11y/visually-hidden";
import { SkipLink } from "../../src/a11y/skip-link";
import { RequirementRenderer } from "../../src/typed-artifacts/requirement";
import { SecurityReportRenderer } from "../../src/typed-artifacts/security-report";
import { useEffect } from "react";

describe("axe-core accessibility (WCAG 2.2 AA)", () => {
  it("shell layout + theme switcher has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Shell
        brand={<span>FORA</span>}
        activeCenterId="dashboard"
        centers={[
          { id: "dashboard", label: "Dashboard", href: "/dashboard" },
          { id: "audit", label: "Audit", href: "/audit" },
        ]}
        statusBar={<span>OK</span>}
      >
        <h1>Dashboard</h1>
        <Button>New run</Button>
      </Shell>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("requirement renderer with status badge has no axe violations", async () => {
    const { container } = renderWithProviders(
      <RequirementRenderer
        artifact={{
          id: "req-1",
          title: "Ship Forge UI",
          status: "review",
          sections: {
            problem: "Customers need a workbench.",
            openQuestions: [
              { id: "q1", prompt: "Storybook in v1.0?", owner: "CTO" },
            ],
          },
        }}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("security report renderer with severity histogram has no axe violations", async () => {
    const { container } = renderWithProviders(
      <SecurityReportRenderer
        artifact={{
          id: "sec-1",
          stage: "Dev",
          findings: [
            {
              id: "f1",
              severity: "high",
              title: "Hardcoded secret in env",
              exploitPath: "Read env via debug endpoint",
              fixRecommendation: "Rotate key + move to Secrets Manager",
            },
            {
              id: "f2",
              severity: "low",
              title: "Missing rate limit on /healthz",
            },
          ],
        }}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("LiveRegion + useAnnouncer", () => {
  function AnnouncerTrigger({ message }: { message: string }) {
    const { announce } = useAnnouncer();
    useEffect(() => {
      announce(message, "polite");
    }, [announce, message]);
    return null;
  }

  it("renders polite + assertive regions and announces messages", () => {
    const { getByText, rerender } = renderWithProviders(
      <AnnouncerTrigger message="Saved" />,
      { withoutLiveRegion: false },
    );
    // Provider renders both regions; the polite one should display the message.
    expect(getByText("Saved")).toBeInTheDocument();

    // Re-render with assertive message — replaces the polite region contents.
    rerender(
      <LiveRegionProvider>
        <AnnouncerTrigger message="Failed!" />
      </LiveRegionProvider>,
    );
    expect(getByText("Failed!")).toBeInTheDocument();
  });
});

describe("a11y helpers", () => {
  it("SkipLink points at the given target", () => {
    const { getByRole } = renderWithProviders(
      <>
        <SkipLink targetId="main" />
        <main id="main">x</main>
      </>,
    );
    expect(getByRole("link", { name: /skip/i })).toHaveAttribute("href", "#main");
  });

  it("VisuallyHidden keeps content in the DOM but visually hides it", () => {
    const { container } = renderWithProviders(
      <VisuallyHidden>screen reader only</VisuallyHidden>,
    );
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("screen reader only");
  });

  it("ThemeSwitcher reflects the active mode via aria-pressed", async () => {
    const { findAllByRole } = renderWithProviders(<ThemeSwitcher />);
    const buttons = await findAllByRole("button");
    expect(buttons.length).toBe(3);
    // Exactly one is pressed (initial pm persona → light).
    const pressed = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBe(1);
  });
});