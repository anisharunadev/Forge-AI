import type { JSX } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../tokens/cn";

/**
 * VisuallyHidden — keeps content in the accessibility tree while hiding it
 * visually. Used for screen-reader-only labels on icon-only buttons (Plan 3
 * §3.3: meaningful icons must have aria-label).
 */
export function VisuallyHidden({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "absolute h-px w-px overflow-hidden whitespace-nowrap p-0",
        "clip-[rect(0,0,0,0)] clip-path-[inset(50%)]",
        className,
      )}
      {...props}
    />
  );
}