'use client';

/**
 * Step 37 — Custom sheet for the Co-pilot floating panel.
 *
 * Built directly on Radix Dialog primitives (instead of the shared
 * `SheetContent`) so we can:
 *
 *   1. Skip the overlay on desktop ≥1024px (the panel itself is
 *      visually dominant — dimming the page is unnecessary noise).
 *   2. Render a soft `bg-black/40 backdrop-blur-sm` overlay on
 *      mobile (<768px), where the panel takes the full screen.
 *   3. Animate from the right edge with the same easing as the
 *      shared Sheet so the transition still feels native.
 *
 * The shared `Sheet`/`SheetContent` components render an unconditional
 * overlay, which conflicts with the Step 37 FIX 5 directive.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

interface CoPanelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Forwarded to the dialog content for a11y. */
  'aria-describedby'?: string;
  className?: string;
  children: React.ReactNode;
}

export function CoPanelSheet({
  open,
  onOpenChange,
  'aria-describedby': ariaDescribedBy,
  className,
  children,
}: CoPanelSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop — hidden on desktop (lg+), visible on mobile.
            We use the `hidden lg:block` Tailwind utility so the
            element stays in the React tree (Radix needs it for the
            dialog lifecycle) without painting anything on desktop. */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/40 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'hidden lg:block',
          )}
          // On desktop we don't want to trap focus on the overlay
          // click — the panel is the focus surface.
          forceMount={undefined}
        />

        <DialogPrimitive.Content
          aria-describedby={ariaDescribedBy}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col gap-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)]',
            // Mobile: take full screen so the overlay is redundant.
            // Desktop: clamp to 420px (per Step 19/24).
            'h-full sm:max-w-[420px]',
            // Animations — slide in from the right.
            'transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:duration-300 data-[state=open]:duration-500',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            className,
          )}
        >
          {children}
          {/* Visually hidden close affordance — Radix requires it for
              a11y; users typically use the X in the header instead. */}
          <DialogPrimitive.Close className="sr-only" aria-label="Close Co-pilot">
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default CoPanelSheet;
