import { forwardRef, type AnchorHTMLAttributes } from "react";
import { cn } from "../tokens/cn";

export interface SkipLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** ID of the element to skip to (must be focusable / contain a focusable child). */
  targetId: string;
  /** Visible label. Defaults to "Skip to main content". */
  label?: string;
}

/**
 * SkipLink — WCAG 2.4.1 Bypass Blocks. Renders as the first focusable element
 * on the page so keyboard users can jump past the navigation chrome.
 */
export const SkipLink = forwardRef<HTMLAnchorElement, SkipLinkProps>(
  function SkipLink(
    { targetId, label = "Skip to main content", className, ...props },
    ref,
  ) {
    return (
      <a
        ref={ref}
        href={`#${targetId}`}
        className={cn("skip-link", className)}
        {...props}
      >
        {label}
      </a>
    );
  },
);