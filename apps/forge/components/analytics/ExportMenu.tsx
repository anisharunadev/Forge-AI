'use client'

/**
 * ExportMenu — popover menu for CSV (flattened) / JSON (raw) export.
 *
 * When the analytics snapshot is empty we disable both options and
 * surface a toast. Per the design system spec, the parent owns the
 * data — this component just calls the provided serializers so the
 * CSV schema lives next to the data definitions, not in UI code.
 *
 * Skill influence:
 *   - `ux` (Color Only) — disabled state is also explained by a
 *     textual "No data" badge, not just the greyed-out button.
 *   - `ux` (Feedback: Empty States) — toast confirms the export
 *     intent; we never silently trigger a download.
 */

import * as React from 'react'
import { Download, FileJson, FileText, Lock } from 'lucide-react'
import { toast } from 'sonner'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ExportPayload {
  /** Arbitrary JSON-serializable snapshot. The parent decides the shape. */
  data: unknown
  /** Filename without extension. Defaults to "analytics". */
  filename?: string
}

export interface ExportMenuProps {
  disabled?: boolean
  /** Called when the user picks a format. The parent owns the download. */
  onExport: (format: 'csv' | 'json', payload: ExportPayload) => void | Promise<void>
  payload: ExportPayload
  className?: string
}

export function ExportMenu({
  disabled,
  onExport,
  payload,
  className,
}: ExportMenuProps) {
  const [open, setOpen] = React.useState(false)

  const handle = React.useCallback(
    async (format: 'csv' | 'json') => {
      if (disabled) {
        toast.error('No analytics data yet', {
          description: 'Run your first command, then export.',
        })
        return
      }
      try {
        await onExport(format, payload)
        toast.success(
          `${format === 'csv' ? 'CSV' : 'JSON'} export ready`,
          {
            description: `${payload.filename ?? 'analytics'}.${format}`,
          },
        )
        setOpen(false)
      } catch (err) {
        toast.error('Export failed', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    },
    [disabled, onExport, payload],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="analytics-export"
          disabled={disabled}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--fg-primary)] transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          {disabled ? (
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Export
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 p-1"
        data-testid="analytics-export-menu"
      >
        <button
          type="button"
          onClick={() => handle('csv')}
          disabled={disabled}
          data-testid="export-csv"
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-primary)] transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.04)] focus:outline-none focus-visible:bg-[rgba(255,255,255,0.04)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5 text-[var(--accent-emerald)]" aria-hidden="true" />
          <span className="flex-1">CSV (flattened)</span>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">.csv</span>
        </button>
        <button
          type="button"
          onClick={() => handle('json')}
          disabled={disabled}
          data-testid="export-json"
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-primary)] transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.04)] focus:outline-none focus-visible:bg-[rgba(255,255,255,0.04)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileJson className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
          <span className="flex-1">JSON (raw)</span>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">.json</span>
        </button>
        {disabled ? (
          <p
            className="mt-1 px-2 pb-1 text-[10px] text-[var(--fg-tertiary)]"
            data-testid="export-disabled-hint"
          >
            No data — run a command to enable export.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
