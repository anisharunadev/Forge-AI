import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { DemoBanner } from '@/components/seeds/DemoBanner';
import {
  ShellProvider,
  Sidebar,
  Topbar,
  MobileNav,
  ShellBreadcrumbs,
  PageContainer,
} from '@/components/shell';

/**
 * Font registration via `next/font/google`.
 *
 * Inter is the primary face; JetBrains Mono is reserved for IDs,
 * hashes, code, and contract fields. Both are exposed as CSS
 * variables (`--font-sans`, `--font-mono`) and consumed by
 * `tailwind.config.ts` and `app/globals.css`.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: {
    default: 'Forge AI',
    template: '%s · Forge AI',
  },
  description:
    'Agent operating system — orchestrate agents, knowledge, governance, and delivery workflows.',
  applicationName: 'Forge AI',
  keywords: ['AI agents', 'SDLC', 'orchestration', 'governance', 'developer tools'],
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#09090B' },
    { media: '(prefers-color-scheme: light)', color: '#FAFAFA' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <Providers>
          <ShellProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                {/*
                 * DemoBanner (Plan G commit 3) — sticky amber alert that
                 * surfaces on every page when the demo `acme-corp` seed
                 * is applied. Mounted ABOVE the Topbar so it remains the
                 * first thing the user sees on scroll. The banner self-
                 * returns null when the seed has not been applied, so
                 * non-demo tenants incur zero render cost.
                 */}
                <DemoBanner />
                <Topbar />
                <ShellBreadcrumbs />
                <main id="main-content" className="min-w-0 flex-1">
                  <PageContainer>{children}</PageContainer>
                </main>
              </div>
              <MobileNav />
            </div>
          </ShellProvider>
        </Providers>
      </body>
    </html>
  );
}
