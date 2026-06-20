import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  PERSONA_DEFAULT_THEME,
  ThemeProvider,
  useTheme,
} from "../../src/tokens/theme";

function Probe() {
  const { theme, mode, persona, setMode, setPersona } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="mode">{mode}</span>
      <span data-testid="persona">{persona}</span>
      <button onClick={() => setMode("dark")}>set-dark</button>
      <button onClick={() => setMode("light")}>set-light</button>
      <button onClick={() => setMode("system")}>set-system</button>
      <button onClick={() => setPersona("cto")}>set-cto</button>
    </div>
  );
}

describe("PERSONA_DEFAULT_THEME", () => {
  it("encodes the per-persona defaults from Plan 3 §4.1", () => {
    expect(PERSONA_DEFAULT_THEME.pm).toBe("light");
    expect(PERSONA_DEFAULT_THEME["eng-lead"]).toBe("dark");
    expect(PERSONA_DEFAULT_THEME.cto).toBe("dark");
    expect(PERSONA_DEFAULT_THEME["vp-eng"]).toBe("dark");
    expect(PERSONA_DEFAULT_THEME.security).toBe("dark");
    expect(PERSONA_DEFAULT_THEME.customer).toBe("system");
  });
});

describe("ThemeProvider", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-persona");
    document.documentElement.removeAttribute("data-investigation-mode");
    window.localStorage.clear();
    document.cookie = "forge-theme=; Max-Age=0; Path=/";
  });

  it("renders children with the persona default mode", () => {
    render(
      <ThemeProvider persona="pm">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("persona")).toHaveTextContent("pm");
    expect(screen.getByTestId("mode")).toHaveTextContent("light");
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-persona")).toBe("pm");
  });

  it("reflects the cto persona default dark mode", () => {
    render(
      <ThemeProvider persona="cto">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("switches mode on user action", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider persona="pm">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("set-dark"));
    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("switching persona applies its default mode (Plan 3 §4.1)", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider persona="pm">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("set-cto"));
    expect(screen.getByTestId("persona")).toHaveTextContent("cto");
    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
  });

  it("throws when useTheme is used outside ThemeProvider", () => {
    expect(() => render(<Probe />)).toThrow(/useTheme must be used within a ThemeProvider/);
  });

  it("persists mode to localStorage and cookie", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider persona="pm">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("set-dark"));
    expect(window.localStorage.getItem("forge-theme")).toBe("dark");
    expect(document.cookie).toMatch(/forge-theme=dark/);
    // Flush the act warning suppression
    await act(async () => {});
  });
});
