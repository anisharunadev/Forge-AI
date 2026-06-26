'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { NavList } from './Sidebar';
import { useShell } from './ShellProvider';

/**
 * Mobile navigation drawer — uses the same nav config as the desktop
 * sidebar, just rendered inside a `Sheet` (left) instead of a persistent
 * `<aside>`.
 *
 * Open state is owned by `<ShellProvider>` so the Topbar's Menu button
 * drives it.
 */
export function MobileNav() {
  const { mobileNavOpen, setMobileNavOpen, closeMobileNav } = useShell();
  const pathname = usePathname() ?? '/';

  // Auto-close the drawer on route change so the user lands on the
  // new page with chrome gone.
  React.useEffect(() => {
    if (mobileNavOpen) {
      closeMobileNav();
    }
    // We deliberately listen to pathname, not the close function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent
        side="left"
        className="flex w-72 flex-col gap-0 p-0"
        data-testid="mobile-nav"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-sm font-semibold tracking-tight">
            <Link
              href="/dashboard"
              className="flex items-center gap-2"
              onClick={closeMobileNav}
            >
              <div className="forge-mark" aria-hidden="true">
                <span className="text-sm font-bold">F</span>
              </div>
              <span>Forge AI</span>
            </Link>
          </SheetTitle>
          <SheetDescription className="text-2xs uppercase tracking-wider">
            Agent OS
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NavList pathname={pathname} collapsed={false} onNavigate={closeMobileNav} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
