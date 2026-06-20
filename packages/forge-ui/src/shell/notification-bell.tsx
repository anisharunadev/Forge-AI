import type { JSX } from "react";
import { Bell } from "lucide-react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";

export interface NotificationBellProps {
  /** Unread count. 0 hides the count badge. */
  readonly unreadCount?: number;
  /** Called when the bell is clicked. */
  readonly onClick?: () => void;
  /** Accessible label override. */
  readonly ariaLabel?: string;
  className?: string;
}

/**
 * NotificationBell — Plan 3 §6. Top-bar bell with unread count badge. Pairs
 * with LiveRegionProvider so new notifications are announced (Plan 3 §5.1:
 * 4.1.3 Status messages).
 */
export function NotificationBell({
  unreadCount = 0,
  onClick,
  ariaLabel,
  className,
}: NotificationBellProps): JSX.Element {
  const label = ariaLabel ?? `Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-sm text-ink-default hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        className,
      )}
    >
      <Bell size={18} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5">
          <Badge tone="danger" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        </span>
      )}
    </button>
  );
}
