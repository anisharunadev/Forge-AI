'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Dark/light theme toggle.
 *
 * The theme is owned by `next-themes` (mounted in `Providers`); the
 * `class` attribute on `<html>` flips between `.dark` and the light
 * `:root` block per the tokens in `app/globals.css`.
 *
 * Pre-hydration we render a stable Sun + opacity-0 placeholder so
 * the icon doesn't flicker between server and client.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : true;
  const next = isDark ? 'light' : 'dark';

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Switch to ${next} theme`}
            data-testid="theme-toggle"
            onClick={() => setTheme(next)}
          >
            {mounted && isDark ? (
              <Moon className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Sun className="h-4 w-4" aria-hidden="true" />
            )}
            {!mounted ? (
              <Sun
                className="h-4 w-4 opacity-0"
                aria-hidden="true"
              />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
