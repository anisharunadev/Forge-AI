import type { JSX } from "react";
import type { ReactNode } from "react";
import { SkipLink } from "../a11y/skip-link";
import { ThemeSwitcher } from "./theme-switcher";
import { cn } from "../tokens/cn";

export interface ShellProps {
  /** Centers rendered in the left rail. */
  readonly centers: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly icon?: ReactNode;
  }>;
  /** Main canvas content. */
  readonly children: ReactNode;
  /** Optional right panel (context side panel). */
  readonly rightPanel?: ReactNode;
  /** Optional footer status bar. */
  readonly statusBar?: ReactNode;
  /** Optional top-bar brand element. */
  readonly brand?: ReactNode;
  /** Active center id; used to mark the rail item aria-current. */
  readonly activeCenterId?: string;
  className?: string;
}

/**
 * Shell — Plan 3 §6 layout (top bar, left rail, main, right panel, status bar).
 * Wrap every center with this. The SkipLink is the first focusable element so
 * keyboard users can bypass the chrome (WCAG 2.4.1).
 */
export function Shell({
  centers,
  children,
  rightPanel,
  statusBar,
  brand,
  activeCenterId,
  className,
}: ShellProps) {
  return (
    <div className={cn("min-h-screen bg-surface text-ink-default", className)}>
      <SkipLink targetId="forge-main" />

      <header
        role="banner"
        className="flex h-14 items-center justify-between border-b border-surface-border bg-surface-raised px-4"
      >
        <div className="flex items-center gap-3">
          {brand ?? <span className="text-heading-3 font-semibold">FORA</span>}
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
        </div>
      </header>

      <div className="flex">
        <nav
          aria-label="Centers"
          className="w-56 shrink-0 border-r border-surface-border bg-surface-raised p-2"
        >
          <ul className="space-y-1">
            {centers.map((c) => {
              const isActive = c.id === activeCenterId;
              return (
                <li key={c.id}>
                  <a
                    href={c.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-body",
                      "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2",
                      isActive
                        ? "bg-brand-primary/10 text-brand-primary font-medium"
                        : "text-ink-default",
                    )}
                  >
                    {c.icon}
                    <span>{c.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <main
          id="forge-main"
          tabIndex={-1}
          className="flex-1 p-6 focus:outline-none"
        >
          {children}
        </main>

        {rightPanel && (
          <aside
            aria-label="Context panel"
            className="w-80 shrink-0 border-l border-surface-border bg-surface-raised p-4"
          >
            {rightPanel}
          </aside>
        )}
      </div>

      {statusBar && (
        <footer
          role="contentinfo"
          className="border-t border-surface-border bg-surface-raised px-4 py-2 text-caption text-ink-muted"
        >
          {statusBar}
        </footer>
      )}
    </div>
  );
}