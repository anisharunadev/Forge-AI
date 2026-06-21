import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Home,
  Compass,
  GitBranch,
  Shield,
  Layers,
  Network,
  PlugZap,
  Lightbulb,
  Activity,
  TerminalSquare,
  Library,
  Building2,
  Wrench,
  ClipboardList,
  Settings,
} from 'lucide-react';

import { Providers } from '@/components/providers';
import { SEED_TENANT_ID, SEED_TENANT_NAME } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Forge',
  description: 'Agent operating system — orchestration, governance, delivery.',
};

export const dynamic = 'force-dynamic';

/**
 * Single developer-focused navigation. No persona switching, no role-based
 * visibility — every developer on the team sees the same workspace.
 * Replaces the previous persona-aware sidebar.
 */
const NAV: ReadonlyArray<{
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  group: 'workspace' | 'centers' | 'lifecycle';
}> = [
  // Workspace
  { href: '/dashboard',            label: 'Dashboard',     icon: Home,         group: 'workspace' },
  { href: '/forge-command-center', label: 'Command',       icon: Compass,      group: 'workspace' },
  { href: '/forge-terminal',       label: 'Terminal',      icon: TerminalSquare, group: 'workspace' },
  { href: '/runs',                 label: 'Runs',          icon: Activity,     group: 'workspace' },

  // Centers
  { href: '/connector-center',     label: 'Connectors',    icon: PlugZap,      group: 'centers' },
  { href: '/agent-center',         label: 'Agents',        icon: GitBranch,    group: 'centers' },
  { href: '/knowledge-center',     label: 'Knowledge',     icon: Library,      group: 'centers' },
  { href: '/organization-knowledge', label: 'Org',         icon: Building2,    group: 'centers' },
  { href: '/project-intelligence', label: 'Projects',      icon: Layers,       group: 'centers' },
  { href: '/governance-center',    label: 'Governance',    icon: Shield,       group: 'centers' },
  { href: '/ideation',             label: 'Ideation',      icon: Lightbulb,    group: 'centers' },
  { href: '/architecture',         label: 'Architecture',  icon: Network,      group: 'centers' },

  // Lifecycle
  { href: '/project-onboarding',   label: 'Onboarding',    icon: ClipboardList, group: 'lifecycle' },
  { href: '/audit',                label: 'Audit',         icon: Wrench,       group: 'lifecycle' },
  { href: '/analytics',            label: 'Analytics',     icon: Activity,     group: 'lifecycle' },
];

const GROUP_LABELS: Record<typeof NAV[number]['group'], string> = {
  workspace: 'Workspace',
  centers: 'Centers',
  lifecycle: 'Lifecycle',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const grouped = (['workspace', 'centers', 'lifecycle'] as const).map((g) => ({
    group: g,
    items: NAV.filter((n) => n.group === g),
  }));

  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-forge-950 text-forge-50 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.10),_transparent_60%),radial-gradient(ellipse_at_bottom_right,_rgba(139,92,246,0.08),_transparent_50%)] antialiased">
        <Providers>
          <div className="flex min-h-screen">
            {/* Persistent left sidebar — same for everyone. */}
            <aside
              className="hidden w-60 shrink-0 border-r border-forge-700/60 bg-forge-900/80 backdrop-blur md:flex md:flex-col"
              data-testid="app-sidebar"
            >
              <div className="flex items-center gap-2 px-5 py-4">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-glow-brand">
                  <span className="text-sm font-bold">F</span>
                </div>
                <div className="leading-tight">
                  <Link href="/" className="block text-sm font-semibold tracking-tight">
                    Forge
                  </Link>
                  <p className="text-[10px] uppercase tracking-wider text-forge-400">
                    Agent OS
                  </p>
                </div>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 pb-6">
                {grouped.map(({ group, items }) => (
                  <div key={group} className="mt-4 first:mt-0">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-forge-400">
                      {GROUP_LABELS[group]}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-forge-200 transition hover:bg-forge-800/60 hover:text-white"
                              data-nav={item.label.toLowerCase()}
                            >
                              <Icon
                                className="h-4 w-4 text-forge-400 group-hover:text-brand-400"
                                aria-hidden={true}
                              />
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>

              <div className="border-t border-forge-700/60 px-4 py-3 text-[11px] text-forge-400">
                <div className="flex items-center justify-between gap-2">
                  <span title={SEED_TENANT_ID}>
                    tenant · {SEED_TENANT_NAME}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-forge-500">
                  {SEED_TENANT_ID}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Link
                    href="/healthz"
                    className="inline-flex items-center gap-1 hover:text-forge-200"
                    data-testid="sidebar-healthz"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    health
                  </Link>
                  <Link
                    href="/admin"
                    className="inline-flex items-center gap-1 hover:text-forge-200"
                    aria-label="Settings"
                  >
                    <Settings className="h-3.5 w-3.5" aria-hidden={true} />
                  </Link>
                </div>
              </div>
            </aside>

            {/* Main content — no top bar persona switcher. */}
            <main className="min-w-0 flex-1">
              <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}