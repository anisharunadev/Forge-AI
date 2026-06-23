/**
 * app/not-found.tsx — 404 boundary.
 *
 * Renders inside the root layout (so no <html>/<body> needed), using
 * the new shell tokens and shadcn primitives. Plan 0.5-02 swaps the
 * legacy `.card` styling for semantic tokens + a Card primitive and
 * adds a "Back to dashboard" call to action so the user never lands
 * on a dead end.
 *
 * Per the curated spec, a 404 should be scannable in under a second:
 *   - eyebrow
 *   - heading
 *   - body
 *   - primary CTA
 */

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function NotFound() {
  return (
    <main
      className="flex min-h-[60vh] items-center justify-center py-16"
      data-testid="app-not-found"
    >
      <Card className="max-w-xl">
        <CardHeader>
          <p className="text-2xs font-semibold uppercase tracking-wider text-subtle">
            404
          </p>
          <CardTitle className="text-24">Page not found</CardTitle>
          <CardDescription>
            The run id or page you tried to open is not visible to the
            seeded <code className="font-mono text-xs">acme-corp</code>{' '}
            tenant, or the orchestrator is unreachable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Stages are not yet written for this run. If you reached this
            page from a dashboard card, the run may have been deleted or
            never started.
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go to home</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
