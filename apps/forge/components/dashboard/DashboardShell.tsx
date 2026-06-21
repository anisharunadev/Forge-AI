'use client';

import Link from 'next/link';
import { ArrowRight, Command, TerminalSquare } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface DashboardShellProps {
  children?: React.ReactNode;
}

/**
 * Wraps the existing dashboard content with two entry-point cards linking
 * into the new Command Center and Terminal Center.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2" aria-label="Quick centers">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Command className="h-4 w-4" aria-hidden="true" />
                Open Command Center
              </CardTitle>
              <CardDescription>
                Browse the full <code>forge-*</code> command catalog and dispatch
                to the orchestrator.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link href="/forge-command-center">
                Go to Command Center
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <TerminalSquare className="h-4 w-4" aria-hidden="true" />
                Open Terminal Center
              </CardTitle>
              <CardDescription>
                Spin up xterm.js-backed sessions with split-pane layouts, agent
                selection, and an audit log.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link href="/forge-terminal">
                Go to Terminal Center
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {children}
    </div>
  );
}
