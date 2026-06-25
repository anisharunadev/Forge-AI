/**
 * Runs-specific 404 boundary.
 *
 * Triggered when `/runs/{id}` is hit with an unknown id — the
 * detail page calls `notFound()` when `getRun` returns 404.
 * Renders inside the root layout (no `<html>` / `<body>`).
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

export default function RunNotFound() {
  return (
    <main
      className="flex min-h-[60vh] items-center justify-center py-16"
      data-testid="runs-not-found"
    >
      <Card className="max-w-xl">
        <CardHeader>
          <p className="text-2xs font-semibold uppercase tracking-wider text-subtle">
            404
          </p>
          <CardTitle className="text-24">Run not found</CardTitle>
          <CardDescription>
            The run id you tried to open is not visible to the seeded
            <code className="ml-1 font-mono text-xs">acme-corp</code>
            tenant, or the orchestrator is unreachable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This run may have been deleted, never started, or belong to a
            different tenant. Back to the Runs Center to see the runs you
            do have access to.
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/runs">Back to Runs Center</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
