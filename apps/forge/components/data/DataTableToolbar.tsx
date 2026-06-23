'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * DataTableToolbar — toolbar primitive for DataTable.
 *
 * Three slots: search (default text input + clear), filter slot
 * (caller-provided ReactNode, e.g., a Select of filter values),
 * sort slot (caller-provided). When `selectedCount` > 0, the
 * `bulkActionSlot` is rendered instead of the filter/sort slots.
 *
 * The toolbar is intentionally generic: it does not know about
 * the column being filtered — consumers wire `onSearchChange`
 * into TanStack's `column.setFilterValue` or a controlled state
 * that drives the filter row.
 */
export interface DataTableToolbarProps {
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  filterSlot?: React.ReactNode
  sortSlot?: React.ReactNode
  selectedCount?: number
  bulkActionSlot?: (selectedCount: number) => React.ReactNode
  className?: string
}

export function DataTableToolbar({
  searchPlaceholder = 'Search…',
  searchValue,
  onSearchChange,
  filterSlot,
  sortSlot,
  selectedCount = 0,
  bulkActionSlot,
  className,
}: DataTableToolbarProps) {
  const hasSelection = selectedCount > 0

  return (
    <div
      data-testid="data-table-toolbar"
      className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="flex flex-1 items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="h-9 pl-8 pr-8 text-13"
            data-testid="data-table-search"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {!hasSelection && filterSlot}
        {!hasSelection && sortSlot}
      </div>
      <div className="flex items-center gap-2">
        {hasSelection && bulkActionSlot ? (
          <div
            data-testid="data-table-bulk-actions"
            className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1 text-12 font-medium text-primary"
          >
            <span>{selectedCount} selected</span>
            {bulkActionSlot(selectedCount)}
          </div>
        ) : (
          <span className="text-12 text-muted-foreground" />
        )}
      </div>
    </div>
  )
}