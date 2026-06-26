'use client';

/**
 * Terminal — Toolbar (Step 36 / Fix 4 + Fix 8).
 *
 * Compact toolbar that sits between the session tabs and the canvas.
 * Surfaces:
 *   - Search        (Ctrl+Shift+F)  toggles the inline search bar.
 *   - Help          (⌘?)            opens the Help overlay (Fix 1).
 *   - Settings                       placeholder; dispatches an event.
 *   - Focus mode    (Ctrl+Shift+M)  hides chrome for distraction-free work.
 *   - More          (Clear/Export/Share) — overflow menu.
 *
 * Skill influence:
 *   - ux-guideline (submit feedback) — copy/paste surface a transient
 *     active-state so the user always sees confirmation.
 *   - ux-guideline (focus states) — every button has a visible focus
 *     ring via the Button component defaults.
 *   - ux-guideline (reduced-motion) — transitions are short.
 */

import * as React from 'react';
import {
  Check,
  Copy,
  ClipboardPaste,
  Download,
  Eraser,
  HelpCircle,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Search,
  Settings,
  Share2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface TerminalToolbarProps {
  onSearch: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onSettings?: () => void;
  /** Whether the search bar is currently open. */
  searchOpen?: boolean;
  /** Open the Help overlay (Fix 1). */
  onOpenHelp: () => void;
  /** Focus mode (Zen) — toggled by Fix 8. */
  focusMode: boolean;
  onToggleFocusMode: () => void;
}

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}

function ToolButton({
  label,
  shortcut,
  icon: Icon,
  onClick,
  active,
  testId,
}: ToolButtonProps) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'h-7 w-7 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
        active && 'bg-[var(--bg-elevated)] text-[var(--fg-primary)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}

export function TerminalToolbar({
  onSearch,
  onCopy,
  onPaste,
  onClear,
  fullscreen,
  onToggleFullscreen,
  onSettings,
  searchOpen,
  onOpenHelp,
  focusMode,
  onToggleFocusMode,
}: TerminalToolbarProps) {
  const [copied, setCopied] = React.useState(false);
  const [pasted, setPasted] = React.useState(false);

  const flash = React.useCallback((which: 'copy' | 'paste', fn: () => void) => {
    fn();
    if (which === 'copy') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    } else {
      setPasted(true);
      window.setTimeout(() => setPasted(false), 1100);
    }
  }, []);

  const exportLog = () => {
    // Stub — would serialize the xterm buffer into a file download.
    window.dispatchEvent(new CustomEvent('forge:terminal:export'));
  };

  const shareSession = () => {
    void navigator.clipboard.writeText(window.location.href);
  };

  return (
    <div
      role="toolbar"
      aria-label="Terminal actions"
      data-testid="terminal-toolbar"
      className="flex items-center gap-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
    >
      <ToolButton
        label={searchOpen ? 'Close search' : 'Search'}
        shortcut="Ctrl+Shift+F"
        icon={Search}
        onClick={onSearch}
        active={searchOpen}
        testId="tb-search"
      />
      <ToolButton
        label={copied ? 'Copied' : 'Copy'}
        shortcut="Ctrl+Shift+C"
        icon={copied ? Check : Copy}
        onClick={() => flash('copy', onCopy)}
        active={copied}
        testId="tb-copy"
      />
      <ToolButton
        label={pasted ? 'Pasted' : 'Paste'}
        shortcut="Ctrl+Shift+V"
        icon={pasted ? Check : ClipboardPaste}
        onClick={() => flash('paste', onPaste)}
        active={pasted}
        testId="tb-paste"
      />
      <ToolButton
        label="Clear"
        shortcut="Ctrl+L"
        icon={Eraser}
        onClick={onClear}
        testId="tb-clear"
      />

      <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

      <ToolButton
        label="Help"
        shortcut="⌘?"
        icon={HelpCircle}
        onClick={onOpenHelp}
        testId="tb-help"
      />
      <ToolButton
        label={focusMode ? 'Exit focus mode' : 'Focus mode'}
        shortcut="Ctrl+Shift+M"
        icon={focusMode ? Minimize2 : Maximize2}
        onClick={onToggleFocusMode}
        active={focusMode}
        testId="tb-focus"
      />
      <ToolButton
        label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        icon={fullscreen ? Minimize2 : Maximize2}
        onClick={onToggleFullscreen}
        active={fullscreen}
        testId="tb-fullscreen"
      />
      <ToolButton
        label="Settings"
        icon={Settings}
        onClick={() => onSettings?.()}
        testId="tb-settings"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="More actions"
            title="More actions"
            data-testid="tb-more"
            className="h-7 w-7 text-[var(--fg-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            Scrollback
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onClear(); }} data-testid="tb-more-clear">
            <Eraser className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Clear scrollback
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); exportLog(); }} data-testid="tb-more-export">
            <Download className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Export log
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); shareSession(); }} data-testid="tb-more-share">
            <Share2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Copy session link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}