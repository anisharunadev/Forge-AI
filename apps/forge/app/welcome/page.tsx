/**
 * `/welcome` — first-run landing (Plan G commit 1).
 *
 * Server component (default in App Router). Renders two cards:
 *   1. "Load Demo (Acme Corp)" — runs `DemoLoader` which applies the
 *      `acme-corp` seed via `POST /seeds/acme-corp/apply`, polls status
 *      until `applied === true`, then redirects to `/dashboard`.
 *   2. "Start Empty" — direct `/dashboard` link; the user can load the
 *      demo later from `/admin/seeds`.
 *
 * The Forge shell (Topbar / Sidebar) is intentionally NOT rendered on
 * this page — it is a marketing-style splash that sits above the
 * navigation. We skip `DashboardShell` / `AdminShell` and render a
 * plain `<main>` so the design language matches the rest of the
 * unauthenticated marketing-style surfaces.
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { DemoLoader } from '@/components/seeds/DemoLoader';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Welcome to Forge',
};

export default function WelcomePage() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-background text-foreground"
    >
      <div className="container mx-auto px-4 py-16 max-w-5xl">
        <header className="mb-10 space-y-2">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Forge AI
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Welcome to Forge
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Take a software idea from requirement to production through
            governed AI workflows. The operating system that orchestrates
            agents, knowledge, governance, and delivery workflows.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card data-testid="welcome-load-demo-card">
            <CardHeader>
              <CardTitle>Load Demo (Acme Corp)</CardTitle>
              <CardDescription>
                Pre-populated with 1,000+ artifacts across 12 microservices.
                Recommended for your first walkthrough.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DemoLoader />
            </CardContent>
            <CardFooter>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard">Skip and explore</Link>
              </Button>
            </CardFooter>
          </Card>

          <Card data-testid="welcome-start-empty-card">
            <CardHeader>
              <CardTitle>Start Empty</CardTitle>
              <CardDescription>
                Begin from scratch. You can load the demo later from
                {' '}<Link href="/admin/seeds" className="underline">/admin/seeds</Link>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                A clean tenant with no demo data. Useful when evaluating
                the onboarding wizard or wiring a real source repository.
              </p>
            </CardContent>
            <CardFooter>
              <Button asChild>
                <Link href="/dashboard">Continue empty</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  );
}