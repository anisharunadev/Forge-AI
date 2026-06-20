import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { ThemeProvider } from "../tokens/theme";
import { LiveRegionProvider } from "../a11y/live-region";

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial persona. Default: "pm" (light theme). */
  persona?: "pm" | "eng-lead" | "cto" | "vp-eng" | "security" | "customer";
  /** Skip the LiveRegionProvider wrapper. */
  withoutLiveRegion?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    persona = "pm",
    withoutLiveRegion = false,
    ...options
  }: RenderWithProvidersOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: React.ReactNode }): ReactElement {
    const inner = (
      <ThemeProvider persona={persona}>{children}</ThemeProvider>
    );
    return withoutLiveRegion ? inner : <LiveRegionProvider>{inner}</LiveRegionProvider>;
  }
  return render(ui, { wrapper: Wrapper, ...options });
}