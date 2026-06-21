/**
 * InvestigationModeToggle — Plan 3 §4.3 + Plan 1 §3.12 (Audit Center).
 *
 * Forces dark mode for the current session — every Audit Center surface
 * (CISO, Security, CTO secondary) renders in high-contrast regardless of
 * the user's stored theme preference. AC: "session-scoped (not
 * tenant-scoped)".
 *
 * Implementation: the existing {@link useTheme} hook already exposes
 * `setInvestigationMode` and does not persist it (theme.tsx writes the
 * theme mode to localStorage + cookie, but `investigationMode` is React
 * state only — so it dies with the tab, exactly matching the AC). This
 * component is a thin toggle that wires the hook into a button + live region.
 */

import { Eye, EyeOff } from "lucide-react";
import type { JSX } from "react";
import { Button } from "../primitives/button";
import { VisuallyHidden } from "../a11y/visually-hidden";
import { useTheme } from "../tokens/theme";

export interface InvestigationModeToggleProps {
  className?: string;
}

export function InvestigationModeToggle({ className }: InvestigationModeToggleProps): JSX.Element {
  const { investigationMode, setInvestigationMode } = useTheme();
  const on = investigationMode === "on";
  return (
    <Button
      type="button"
      variant={on ? "primary" : "ghost"}
      size="sm"
      aria-pressed={on}
      aria-label={on ? "Investigation mode on" : "Investigation mode off"}
      onClick={() => setInvestigationMode(on ? "off" : "on")}
      className={className}
      data-investigation-toggle={on ? "on" : "off"}
    >
      {on ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
      <VisuallyHidden>{on ? "Disable" : "Enable"} investigation mode</VisuallyHidden>
      <span aria-hidden="true" className="ml-1">
        {on ? "Investigation" : "Normal"}
      </span>
    </Button>
  );
}
