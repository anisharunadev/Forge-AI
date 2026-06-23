'use client'

import * as React from 'react'
import type { Row } from '@tanstack/react-table'
import { Check, Minus } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * DataTableRowCheckbox — row-level selection checkbox.
 *
 * Renders a custom tri-state checkbox:
 *   - checked    -> Check icon
 *   - partial    -> Minus icon
 *   - unchecked  -> empty box
 *
 * Wired to TanStack's `row.getToggleSelectedHandler()`. Hidden
 * entirely if the row cannot be selected (e.g., disabled by
 * `enableRowSelection: row => row.original.isSelectable`).
 */
export interface DataTableRowCheckboxProps<TData> {
  row: Row<TData>
}

export function DataTableRowCheckbox<TData>({
  row,
}: DataTableRowCheckboxProps<TData>) {
  const checked = row.getIsSelected()
  const indeterminate = row.getIsSomeSelected() && !checked
  const disabled = !row.getCanSelect()

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={checked ? 'Deselect row' : 'Select row'}
      disabled={disabled}
      onClick={row.getToggleSelectedHandler()}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          row.getToggleSelectedHandler()(e)
        }
      }}
      data-state={
        checked ? 'checked' : indeterminate ? 'indeterminate' : 'unchecked'
      }
      data-testid={`row-checkbox-${row.id}`}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'border-primary bg-primary text-primary-foreground',
        indeterminate && 'border-primary bg-primary/70 text-primary-foreground',
      )}
    >
      {checked && <Check className="h-3 w-3" />}
      {indeterminate && <Minus className="h-3 w-3" />}
    </button>
  )
}