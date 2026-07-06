/**
 * Forge AI primary navigation — single source of truth.
 *
 * Pure data + helpers. No JSX, no React imports, no 'use client'.
 * Server-importable so the layout stays a Server Component.
 *
 * Sprint 1.1 (user feedback, see `app/page.tsx`): the OUTCOMES
 * sidebar group was removed because it duplicated existing entries
 * (Start a new project → /project-onboarding, Capture an idea →
 * /ideation, etc.). The workflow spine (components/workflow/*)
 * replaces it as the unifying surface.
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
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/** Valid icon names for NAV entries. */
export type IconName =
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
  | 'LineChart'
  | 'Sparkles';

/** Grouping used by Sidebar + MobileNav + CommandPalette. */
export type NavGroup = 'workspace' | 'centers' | 'lifecycle';

/** A single primary-nav entry. */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly iconName: IconName;
  readonly group: NavGroup;
  /** Extra search tokens for the command palette. */
  readonly keywords?: ReadonlyArray<string>;
  /** Mark legacy routes; the UI may badge these in a follow-up. */
  readonly legacy?: boolean;
}

/** Map of IconName to a Lucide component. */
export const ICONS: Record<IconName, LucideIcon> = {
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
  Sparkles: Sparkles,
};

/**
 * Primary navigation.
 *
 * If you add a page, add it here. Power users reach any center via
 * ⌘K (searchNav) or the Capabilities group in the sidebar.
 */
export const NAV: ReadonlyArray<NavItem> = [
  // Workspace
  { href: '/dashboard', label: 'Dashboard', iconName: 'Home', group: 'workspace' },
  { href: '/copilot', label: 'Co-pilot', iconName: 'Sparkles', group: 'workspace', keywords: ['ai', 'chat', 'assistant', 'cmd+j', '⌘j'] },

  // Centers (Capabilities)
  { href: '/agent-center', label: 'Agents', iconName: 'Bot', group: 'centers', keywords: ['agent', 'registry'] },
  { href: '/project-intelligence', label: 'Projects', iconName: 'Layers', group: 'centers', keywords: ['epic', 'brief', 'draft prd'] },
  { href: '/stories', label: 'Stories', iconName: 'FileText', group: 'centers', keywords: ['story', 'kanban', 'backlog'] },
  { href: '/workflows', label: 'Workflows', iconName: 'Workflow', group: 'centers' },
  { href: '/knowledge-center', label: 'Knowledge', iconName: 'Library', group: 'centers', keywords: ['kg', 'graph'] },
  { href: '/organization-knowledge', label: 'Artifacts', iconName: 'Database', group: 'centers' },
  { href: '/ideation', label: 'Ideation', iconName: 'Lightbulb', group: 'centers', keywords: ['idea', 'prd', 'roadmap'] },
  { href: '/architecture', label: 'Architecture', iconName: 'Network', group: 'centers', keywords: ['adr', 'arch'] },
  { href: '/connector-center', label: 'Connectors', iconName: 'PlugZap', group: 'centers', keywords: ['integration', 'mcp'] },

  // Lifecycle & governance
  { href: '/project-onboarding', label: 'Onboarding', iconName: 'ClipboardList', group: 'lifecycle', keywords: ['wizard', 'setup'] },
  { href: '/governance-center', label: 'Governance', iconName: 'Shield', group: 'lifecycle', keywords: ['approval'] },
  { href: '/audit', label: 'Audit', iconName: 'Wrench', group: 'lifecycle', keywords: ['timeline', 'log'] },
  { href: '/analytics', label: 'Analytics', iconName: 'LineChart', group: 'lifecycle', keywords: ['cost', 'metrics'] },
  { href: '/forge-terminal', label: 'Terminal', iconName: 'TerminalSquare', group: 'lifecycle', legacy: true },
  { href: '/runs', label: 'Runs', iconName: 'Activity', group: 'lifecycle', legacy: true },
  { href: '/forge-command-center', label: 'Command', iconName: 'Compass', group: 'lifecycle', legacy: true, keywords: ['catalog', 'dispatch'] },
  { href: '/admin', label: 'Settings', iconName: 'Settings', group: 'lifecycle' },
];

/** Display labels for each group, in render order. */
export const GROUP_LABELS: Record<NavGroup, string> = {
  workspace: 'Workspace',
  centers: 'Capabilities',
  lifecycle: 'Lifecycle',
};

/** Group order. */
const GROUP_ORDER: ReadonlyArray<NavGroup> = [
  'workspace',
  'centers',
  'lifecycle',
];

export interface GroupedNav {
  readonly group: NavGroup;
  readonly items: ReadonlyArray<NavItem>;
}

/** Return the NAV array grouped + ordered, ready to render. */
export function groupedNav(): ReadonlyArray<GroupedNav> {
  return GROUP_ORDER.map((group) => ({
    group,
    items: NAV.filter((n) => n.group === group),
  }));
}

/** Strip `?query` and `#hash` from a href so `isNavMatch` can compare
 *  the *route* only, not the deep link. */
function stripQuery(href: string): string {
  const queryIdx = href.indexOf('?');
  if (queryIdx === -1) return href;
  return href.slice(0, queryIdx);
}

/** Does `pathname` match `item.href`? True when the href (sans query)
 *  is an exact prefix of the pathname. */
export function isNavMatch(pathname: string, item: NavItem): boolean {
  if (item.href.includes('?')) {
    const [base, query] = item.href.split('?');
    if (base !== undefined && query !== undefined && query.includes('=')) {
      const needle = `?${query}`;
      if (pathname.startsWith(base) && pathname.includes(needle)) {
        return true;
      }
    }
    return false;
  }
  const href = stripQuery(item.href);
  if (pathname === href) return true;
  if (pathname.startsWith(href + '/')) return true;
  return false;
}

/** Case-insensitive substring match over `label` + `keywords`. */
export function searchNav(
  query: string,
  limit = 25,
): ReadonlyArray<NavItem> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: NavItem[] = [];
  for (const item of NAV) {
    if (matches.length >= limit) break;
    const haystack = [item.label, ...(item.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    if (haystack.includes(q)) {
      matches.push(item);
    }
  }
  return matches;
}