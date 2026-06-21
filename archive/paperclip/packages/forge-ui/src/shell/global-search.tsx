import type { JSX } from "react";
import { Search } from "lucide-react";
import { cn } from "../tokens/cn";

export interface GlobalSearchProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  className?: string;
}

/**
 * GlobalSearch — Plan 3 §6. Top-bar search across the active center.
 * Renders as a labelled input + icon button (visible focus ring, keyboard
 * submit via Enter). The actual search wiring lives in the consumer.
 */
export function GlobalSearch({
  value,
  onChange,
  onSubmit,
  placeholder = "Search…",
  className,
}: GlobalSearchProps): JSX.Element {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
      className={cn("flex items-center gap-1", className)}
    >
      <label htmlFor="forge-global-search" className="sr-only">
        Search
      </label>
      <div className="relative">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <input
          id="forge-global-search"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Global search"
          className="h-8 w-72 rounded-sm border border-surface-border bg-surface pl-7 pr-2 text-body-sm text-ink-default placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>
    </form>
  );
}
