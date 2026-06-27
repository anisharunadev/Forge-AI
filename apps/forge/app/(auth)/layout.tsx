/**
 * `(auth)` route group layout — Zone 3 + Zone 4 (step-52).
 *
 * The root `app/layout.tsx` already wraps every page in the chrome
 * (Sidebar + Topbar + MobileNav). For auth pages we want a clean,
 * centered canvas with no chrome — that's what this layout provides.
 *
 * We DON'T try to unmount the root layout (Next.js doesn't let route
 * groups opt out of their parent). Instead the root layout's chrome
 * is wrapped in `<ShellChrome />` (see `components/shell/ShellChrome.tsx`)
 * which reads the pathname via `usePathname()` and returns `null` for
 * any URL starting with `/login` or `/auth/callback`.
 *
 * What this layout DOES add:
 *   - A full-screen flex container so the login form can center itself.
 *   - A skip-to-content link for keyboard users (matches the root).
 *   - The Sonner `<Toaster />` is already mounted in the root layout,
 *     so login errors automatically get toast treatment.
 *
 * Why a route group and not a top-level `auth/` segment?
 *   - The login URL stays `/login` (matches the design mockups).
 *   - The OAuth callback stays `/auth/callback`.
 *   - Existing routes are unaffected.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in · Forge AI',
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[var(--bg-base)]">
      {/* Ambient gradient — same dark canvas as the rest of the app,
          but a single radial glow to signal "auth surface" without
          adding new visual primitives (per the goal's CONSTRAINTS). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.18), transparent 60%)',
        }}
      />
      <main
        id="main-content"
        className="flex min-h-screen w-full items-center justify-center px-4 py-10 sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}