import type { JSX } from "react";
import type { ReactNode } from "react";
import { useTheme } from "../tokens/theme";
import type { Persona } from "../tokens/types";

const PERSONA_LABEL: Record<Persona, string> = {
  pm: "PM",
  "eng-lead": "Eng Lead",
  cto: "CTO",
  "vp-eng": "VP Eng",
  security: "Security",
  customer: "Customer",
};

export interface PersonaSwitcherProps {
  className?: string;
  /** Optional custom render for each option (defaults to label). */
  renderOption?: (persona: Persona) => ReactNode;
}

/**
 * PersonaSwitcher — Plan 3 §4.1 + Plan 3 §6. Selects the active persona which
 * drives the default theme + accessibility harness. Uses ThemeContext from
 * src/tokens/theme.tsx.
 */
export function PersonaSwitcher({ className, renderOption }: PersonaSwitcherProps): JSX.Element {
  const { persona, setPersona } = useTheme();
  const personas: Persona[] = ["pm", "eng-lead", "cto", "vp-eng", "security", "customer"];
  return (
    <label className={className}>
      <span className="sr-only">Switch persona</span>
      <select
        value={persona}
        onChange={(e) => setPersona(e.target.value as Persona)}
        aria-label="Active persona"
        className="h-8 rounded-sm border border-surface-border bg-surface px-2 text-body-sm text-ink-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {personas.map((p) => (
          <option key={p} value={p}>
            {renderOption ? renderOption(p) : PERSONA_LABEL[p]}
          </option>
        ))}
      </select>
    </label>
  );
}
