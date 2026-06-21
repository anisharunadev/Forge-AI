import type { JSX } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "../primitives/button";
import { useTheme } from "../tokens/theme";
import { VisuallyHidden } from "../a11y/visually-hidden";
import type { ThemeMode } from "../tokens/types";

const OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string; Icon: typeof Sun }> = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

/**
 * ThemeSwitcher — Plan 3 §4.2 (theme override + persistence). Three-button
 * group with the current mode pressed; aria-pressed + aria-label expose state.
 */
export function ThemeSwitcher() {
  const { mode, setMode, theme } = useTheme();

  return (
    <div
      role="group"
      aria-label={`Theme (current: ${theme})`}
      className="inline-flex rounded-md border border-surface-border bg-surface"
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const pressed = mode === id;
        return (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            aria-pressed={pressed}
            aria-label={`${label} theme`}
            onClick={() => setMode(id)}
            className="rounded-none first:rounded-l-md last:rounded-r-md px-2 min-w-[40px]"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <VisuallyHidden>{label}</VisuallyHidden>
          </Button>
        );
      })}
    </div>
  );
}