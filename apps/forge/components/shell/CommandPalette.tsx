'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Activity,
  Compass,
  Home,
  PlugZap,
  Settings as SettingsIcon,
  Shield,
  Stethoscope,
} from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { ICONS, searchNav, type NavItem } from './nav-config';
import { useShell } from './ShellProvider';

interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly keywords: ReadonlyArray<string>;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly run: (helpers: PaletteHelpers) => void;
}

interface PaletteHelpers {
  readonly push: (href: string) => void;
  readonly toggleTheme: () => void;
  readonly close: () => void;
}

/** Static action list — rendered below the dynamic "Jump to" group. */
const ACTIONS: ReadonlyArray<PaletteAction> = [
  {
    id: 'go-dashboard',
    label: 'Go to dashboard',
    keywords: ['home', 'overview'],
    icon: Home,
    run: ({ push, close }) => {
      push('/dashboard');
      close();
    },
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    keywords: ['dark', 'light', 'appearance'],
    icon: Compass,
    run: ({ toggleTheme, close }) => {
      toggleTheme();
      close();
    },
  },
  {
    id: 'view-health',
    label: 'View health',
    keywords: ['status', 'healthz', 'uptime'],
    icon: Stethoscope,
    run: ({ push, close }) => {
      push('/healthz');
      close();
    },
  },
  {
    id: 'open-settings',
    label: 'Open settings',
    keywords: ['admin', 'config'],
    icon: SettingsIcon,
    run: ({ push, close }) => {
      push('/admin');
      close();
    },
  },
  {
    id: 'open-approvals',
    label: 'Open approvals',
    keywords: ['governance', 'pending', 'review'],
    icon: Shield,
    run: ({ push, close }) => {
      push('/governance-center');
      close();
    },
  },
  {
    id: 'open-connectors',
    label: 'Open connectors',
    keywords: ['integration', 'mcp', 'marketplace'],
    icon: PlugZap,
    run: ({ push, close }) => {
      push('/connector-center');
      close();
    },
  },
  {
    id: 'open-runs',
    label: 'Open runs',
    keywords: ['activity', 'history', 'log'],
    icon: Activity,
    run: ({ push, close }) => {
      push('/runs');
      close();
    },
  },
];

/**
 * CMD+K command palette.
 *
 * Two groups:
 *   - **Jump to**  — dynamic, filtered from `searchNav(query)` over `NAV`.
 *   - **Actions**  — static, always visible (theme toggle, health, settings…).
 *
 * Mounted once by `<ShellProvider>`. Open state is owned by the
 * provider so the Topbar trigger and the global Cmd/Ctrl-K listener
 * both work.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = React.useState('');

  // Reset the query whenever the palette closes so the next open
  // starts with a clean input.
  React.useEffect(() => {
    if (!paletteOpen) {
      setQuery('');
    }
  }, [paletteOpen]);

  const helpers: PaletteHelpers = React.useMemo(
    () => ({
      push: (href: string) => router.push(href),
      toggleTheme: () =>
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      close: () => setPaletteOpen(false),
    }),
    [router, resolvedTheme, setTheme, setPaletteOpen],
  );

  const navMatches = React.useMemo(
    () => (query.trim() ? searchNav(query) : []),
    [query],
  );

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      data-testid="command-palette"
    >
      <CommandInput
        placeholder="Search centers, actions, docs…"
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>
          No matches. Try a center like &quot;projects&quot; or an action like
          &quot;theme&quot;.
        </CommandEmpty>

        {navMatches.length > 0 ? (
          <CommandGroup heading="Jump to">
            {navMatches.map((item: NavItem) => {
              const Icon = ICONS[item.iconName];
              return (
                <CommandItem
                  key={item.href + '-' + item.label}
                  value={item.label + ' ' + (item.keywords ?? []).join(' ')}
                  onSelect={() => {
                    router.push(item.href);
                    setPaletteOpen(false);
                  }}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.legacy ? (
                    <span className="ml-auto text-2xs uppercase tracking-wider text-muted-foreground/70">
                      legacy
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {navMatches.length > 0 ? <CommandSeparator /> : null}

        <CommandGroup heading="Actions">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                value={action.label + ' ' + action.keywords.join(' ')}
                onSelect={() => action.run(helpers)}
              >
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>{action.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
