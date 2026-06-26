'use client'

/**
 * DateRangePicker — segmented 7d/30d/90d/Custom control for the
 * Analytics Center hero.
 *
 * Range chips are buttons (not a `<select>`) so they sit flush with
 * the hero's other pill-style controls (Compare, Export). "Custom"
 * reveals a minimal from/to date input pair — when the user picks
 * actual dates, the parent receives an ISO range via `onChange`.
 *
 * Skill influence:
 *   - `ux` (Navigation: Active State) — selected chip uses
 *     `aria-pressed` + accent background, satisfying the high
 *     severity "current page/section should be visually indicated"
 *     rule.
 *   - `ux` (Deep Linking) — we accept an initial `value` prop and
 *     expose the selected range through `onChange`, so a parent can
 *     lift the state into the URL (e.g. ?range=30d).
 */

import * as React from 'react'
import { Calendar } from 'lucide-react'

import { cn } from '@/lib/utils'

export type DateRangePreset = '7d' | '30d' | '90d' | 'custom'

export interface DateRangeValue {
  preset: DateRangePreset
  from?: string // YYYY-MM-DD
  to?: string // YYYY-MM-DD
}

export interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  className?: string
}

const PRESETS: ReadonlyArray<{ value: DateRangePreset; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: 'Custom' },
]

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const handlePreset = (preset: DateRangePreset) => {
    if (preset === 'custom') {
      onChange({ preset: 'custom', from: value.from, to: value.to })
    } else {
      onChange({ preset })
    }
  }

  return (
    <div
      role="group"
      aria-label="Date range"
      data-testid="analytics-date-range"
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1',
        className,
      )}
    >
      <Calendar className="ml-1 h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
      {PRESETS.map((p) => {
        const active = value.preset === p.value
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={active}
            onClick={() => handlePreset(p.value)}
            data-testid={`range-${p.value}`}
            className={cn(
              'rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elevated)]',
              active
                ? 'bg-[var(--accent-primary)] text-white'
                : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
            )}
          >
            {p.label}
          </button>
        )
      })}
      {value.preset === 'custom' ? (
        <div className="ml-1 flex items-center gap-1" data-testid="range-custom-fields">
          <input
            type="date"
            aria-label="From"
            value={value.from ?? ''}
            onChange={(e) =>
              onChange({ preset: 'custom', from: e.target.value, to: value.to })
            }
            className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          />
          <span className="text-xs text-[var(--fg-tertiary)]" aria-hidden="true">
            →
          </span>
          <input
            type="date"
            aria-label="To"
            value={value.to ?? ''}
            onChange={(e) =>
              onChange({ preset: 'custom', from: value.from, to: e.target.value })
            }
            className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          />
        </div>
      ) : null}
    </div>
  )
}
