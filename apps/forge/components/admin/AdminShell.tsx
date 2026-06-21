'use client';

import * as React from 'react';

/**
 * `AdminShell` is now a pass-through wrapper.
 *
 * The persistent Forge sidebar lives in `app/layout.tsx` (single
 * source of truth — same nav for every page). The previous version
 * of `AdminShell` rendered its own per-page nav, which produced a
 * double-sidebar in the screenshot. Existing page imports keep
 * working; the wrapper just yields children.
 *
 * If a center ever needs page-local chrome (breadcrumbs, action
 * toolbar, etc.), add it here as an opt-in slot — not a second nav.
 */
export interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return <>{children}</>;
}