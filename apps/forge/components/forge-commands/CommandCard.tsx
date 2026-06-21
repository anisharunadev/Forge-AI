'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import {
  Bug,
  Rocket,
  Wand2,
  Workflow,
  Bot,
  Lightbulb,
  ListChecks,
  ScrollText,
  Network,
  Database,
  Search,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Users,
  FolderPlus,
  UserPlus,
  FlaskConical,
  ClipboardCheck,
  Replace,
  TestTube2,
  PackageOpen,
  ArrowRightLeft,
  TestTube,
  Layers,
  MonitorPlay,
  PieChart,
  OctagonAlert,
  PackageSearch,
  FileBadge,
  GitPullRequestArrow,
  CheckCheck,
  BookOpenCheck,
  FileSignature,
  Package,
  Server,
  Undo2,
  Flag,
  Milestone,
  TrendingUp,
  ClipboardList,
  CheckCircle2,
  BookmarkPlus,
  BookText,
  GraduationCap,
  Play,
  Gavel,
  Ban,
  PlusSquare,
  Trash2,
  Plug,
  RefreshCw,
  Activity,
  type LucideIcon,
} from 'lucide-react';

import type { ForgeCommand } from '@/lib/forge-commands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const CommandRunDialog = dynamic(
  () =>
    import('@/components/forge-commands/CommandRunDialog').then(
      (m) => m.CommandRunDialog,
    ),
  { ssr: false },
);

const ICONS: Record<string, LucideIcon> = {
  Bug,
  Rocket,
  Wand2,
  Workflow,
  Bot,
  Lightbulb,
  ListChecks,
  ScrollText,
  Network,
  Database,
  Search,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Users,
  FolderPlus,
  UserPlus,
  FlaskConical,
  ClipboardCheck,
  Replace,
  TestTube2,
  PackageOpen,
  ArrowRightLeft,
  TestTube,
  Layers,
  MonitorPlay,
  PieChart,
  OctagonAlert,
  PackageSearch,
  FileBadge,
  GitPullRequestArrow,
  CheckCheck,
  BookOpenCheck,
  FileSignature,
  Package,
  Server,
  Undo2,
  Flag,
  Milestone,
  TrendingUp,
  ClipboardList,
  CheckCircle2,
  BookmarkPlus,
  BookText,
  GraduationCap,
  Play,
  Gavel,
  Ban,
  PlusSquare,
  Trash2,
  Plug,
  RefreshCw,
  Activity,
};

export interface CommandCardProps {
  command: ForgeCommand;
}

export function CommandCard({ command }: CommandCardProps) {
  const [open, setOpen] = React.useState(false);
  const Icon = ICONS[command.icon] ?? Wand2;

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base">{command.label}</CardTitle>
            <code className="block break-all text-xs text-muted-foreground">
              {command.name}
            </code>
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          <CardDescription>{command.description}</CardDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{command.category}</Badge>
            {command.estimatedDuration ? (
              <Badge variant="outline">~{command.estimatedDuration}s</Badge>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="px-2 text-xs text-muted-foreground"
          >
            <a href={`/forge-command-center?history=${command.name}`}>
              View history
            </a>
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            Run
          </Button>
        </CardFooter>
      </Card>

      <CommandRunDialog
        command={command}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
