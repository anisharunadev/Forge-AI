import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { SEED_TENANT_ID, SEED_TENANT_NAME } from '@/lib/auth';

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

/**
 * Forge AI top-level navigation.
 *
 * Phase 0.5-03 will replace this inline array with a config file and
 * add a `usePathname()`-driven active state + mobile Sheet. For now
 * the structure is the new user-specified IA (Dashboard / Agents /
 * Projects / Stories / Workflows / Knowledge / Artifacts / Analytics
 * / Settings) with backward-compat entries for the legacy URLs.
 */
type NavItem = {
  href: string;
  label: string;
  iconName: IconName;
  group: 'workspace' | 'centers' | 'lifecycle';
  legacy?: boolean;
};

type IconName =
  | 'Home'
  | 'Compass'
  | 'GitBranch'
  | 'Shield'
  | 'Layers'
  | 'Network'
  | 'PlugZap'
  | 'Lightbulb'
  | 'Activity'
  | 'TerminalSquare'
  | 'Library'
  | 'Building2'
  | 'Wrench'
  | 'ClipboardList'
  | 'Settings'
  | 'Bot'
  | 'FileText'
  | 'Workflow'
  | 'Database'
  | 'LineChart';

const NAV: ReadonlyArray<NavItem> = [
  // Workspace
  { href: '/dashboard',     label: 'Dashboard',  iconName: 'Home',         group: 'workspace' },

  // Agents (per user spec: Active Agents / Agent Registry / Agent Templates)
  { href: '/agent-center',  label: 'Agents',     iconName: 'Bot',          group: 'centers' },

  // Projects / Stories / Workflows (the core SDLC loop)
  { href: '/project-intelligence', label: 'Projects',  iconName: 'Layers',     group: 'centers' },
  { href: '/project-intelligence?tab=stories', label: 'Stories', iconName: 'FileText', group: 'centers', legacy: true },
  { href: '/forge-command-center', label: 'Workflows', iconName: 'Workflow',  group: 'centers' },

  // Knowledge & Artifacts
  { href: '/knowledge-center',     label: 'Knowledge',  iconName: 'Library',     group: 'centers' },
  { href: '/organization-knowledge', label: 'Artifacts', iconName: 'Database',  group: 'centers' },

  // AI-era pages
  { href: '/ideation',      label: 'Ideation',   iconName: 'Lightbulb',    group: 'centers' },
  { href: '/architecture',  label: 'Architecture', iconName: 'Network',     group: 'centers' },
  { href: '/connector-center', label: 'Connectors', iconName: 'PlugZap',    group: 'centers' },

  // Lifecycle & governance
  { href: '/project-onboarding', label: 'Onboarding', iconName: 'ClipboardList', group: 'lifecycle' },
  { href: '/governance-center', label: 'Governance', iconName: 'Shield',     group: 'lifecycle' },
  { href: '/audit',          label: 'Audit',       iconName: 'Wrench',       group: 'lifecycle' },
  { href: '/analytics',      label: 'Analytics',   iconName: 'LineChart',    group: 'lifecycle' },
  { href: '/forge-terminal', label: 'Terminal',    iconName: 'TerminalSquare', group: 'lifecycle', legacy: true },
  { href: '/runs',           label: 'Runs',        iconName: 'Activity',     group: 'lifecycle', legacy: true },
  { href: '/forge-command-center', label: 'Command', iconName: 'Compass',    group: 'lifecycle', legacy: true },

  // Settings (footer)
  { href: '/admin',          label: 'Settings',   iconName: 'Settings',     group: 'lifecycle' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  workspace: 'Workspace',
  centers: 'Centers',
  lifecycle: 'Lifecycle',
};

/**
 * Map icon names to lucide-react components. Imported lazily so the
 * `Home`/`Compass`/etc. symbols do not bloat the layout bundle. Plan
 * 0.5-03 will replace this with the new <Sidebar> component.
 */
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
  Settings as SettingsIcon,
  Bot,
  FileText,
  Workflow,
  Database,
  LineChart,
} from 'lucide-react';

const ICONS: Record<IconName, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  Home: Home,
  Compass: Compass,
  GitBranch: GitBranch,
  Shield: Shield,
  Layers: Layers,
  Network: Network,
  PlugZap: PlugZap,
  Lightbulb: Lightbulb,
  Activity: Activity,
  TerminalSquare: TerminalSquare,
  Library: Library,
  Building2: Building2,
  Wrench: Wrench,
  ClipboardList: ClipboardList,
  Settings: SettingsIcon,
  Bot: Bot,
  FileText: FileText,
  Workflow: Workflow,
  Database: Database,
  LineChart: LineChart,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const grouped = (['workspace', 'centers', 'lifecycle'] as const).map((g) => ({
    group: g,
    items: NAV.filter((n) => n.group === g),
  }));

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
          <div className="flex min-h-screen">
            {/* Persistent left sidebar — same for everyone.
                Plan 0.5-03 replaces this with <Sidebar> + <MobileNav>. */}
            <aside
              className="hidden w-60 shrink-0 border-r border-border bg-card/80 backdrop-blur md:flex md:flex-col"
              data-testid="app-sidebar"
            >
              <div className="flex items-center gap-2 px-5 py-4">
                <div className="forge-mark" aria-hidden={true}>
                  <span className="text-sm font-bold">F</span>
                </div>
                <div className="leading-tight">
                  <Link href="/" className="block text-sm font-semibold tracking-tight">
                    Forge AI
                  </Link>
                  <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                    Agent OS
                  </p>
                </div>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 pb-6">
                {grouped.map(({ group, items }) => (
                  <div key={group} className="mt-4 first:mt-0">
                    <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {GROUP_LABELS[group]}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const Icon = ICONS[item.iconName];
                        return (
                          <li key={`${item.href}-${item.label}`}>
                            <Link
                              href={item.href}
                              className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              data-nav={item.label.toLowerCase()}
                            >
                              <Icon
                                className="h-4 w-4 text-muted-foreground group-hover:text-primary"
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

              <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span title={SEED_TENANT_ID}>
                    tenant · {SEED_TENANT_NAME}
                  </span>
                </div>
                <div className="mt-1 font-mono text-2xs text-muted-foreground/70">
                  {SEED_TENANT_ID}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Link
                    href="/healthz"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    data-testid="sidebar-healthz"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                    health
                  </Link>
                  <Link
                    href="/admin"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label="Settings"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" aria-hidden={true} />
                  </Link>
                </div>
              </div>
            </aside>

            {/* Main content — no top bar persona switcher. */}
            <main id="main-content" className="min-w-0 flex-1">
              <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
