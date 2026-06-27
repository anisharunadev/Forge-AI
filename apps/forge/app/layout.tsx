import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { ConnectorProvider } from '@/lib/connectors/provider';
import { Toaster } from "sonner";
import { ShellProvider } from "@/components/shell";
import { ShellChrome } from "@/components/shell/ShellChrome";

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
            {/*
             * ConnectorProvider — makes the cross-cutting connector
             * context available to any page. Powers
             * `<ConnectorPicker>`, `<ConnectorActionButton>`,
             * `<ConnectorHealthIndicator>` and
             * `<ConnectorCredentialsBadge>` from anywhere in the app.
             *
             * ShellChrome (step-52) — renders the Sidebar/Topbar/MobileNav
             * for authenticated workspace routes, and a chrome-free canvas
             * for the (auth) route group (`/login`, `/auth/callback`).
             */}
            <ConnectorProvider>
              <ShellChrome>{children}</ShellChrome>
            </ConnectorProvider>
          </ShellProvider>
        </Providers>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            className:
              "rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-md)]",
            duration: 4000,
          }}
          richColors
          closeButton
        />
      </body>
    </html>
  );
}
