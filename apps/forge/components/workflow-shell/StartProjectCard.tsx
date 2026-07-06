/**
 * StartProjectCard — the second CTA on the workflow home page.
 *
 * For first-run users (no project yet), this is the primary entry
 * point. It surfaces the "Start a new project" affordance that
 * previously lived inside /ideation, hidden from new users.
 *
 * Once a project is in flight, the card collapses to a smaller
 * "Start another project" link — never competing with ContinueCard
 * for visual weight.
 */

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StartProjectCardProps {
  readonly hasActiveProject: boolean;
  readonly className?: string;
}

export function StartProjectCard({ hasActiveProject, className }: StartProjectCardProps) {
  return (
    <Card
      data-testid="workflow-start-project-card"
      className={cn(
        'border-border bg-card text-card-foreground',
        hasActiveProject ? 'opacity-90' : 'border-amber-400/40',
        className,
      )}
    >
      <CardHeader>
        <CardTitle className="text-base">
          {hasActiveProject ? 'Start another project' : 'New to Forge?'}
        </CardTitle>
        <CardDescription>
          {hasActiveProject
            ? 'Begin a fresh idea-to-PR workflow for a new product or feature.'
            : 'Forge turns a product idea into a production-ready pull request through seven governed stages.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant={hasActiveProject ? 'outline' : 'secondary'} size="default">
          <Link
            href="/workflow/idea"
            data-testid="workflow-start-cta"
            aria-label="Start a new project from the Idea stage"
          >
            Start from Idea
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}