'use client'

import * as React from 'react'
import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * DataTableColumnHeader — sortable column header for DataTable.
 *
 * Renders the column label with an ArrowUpDown affordance. Clicking
 * cycles the sort state (none -> asc -> desc -> none). The sort icon
 * reflects the current direction; the button is full-width so the
 * entire header cell is clickable.
 */
export interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>
  title: string
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn('text-xs font-medium', className)}>{title}</div>
  }

  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        '-ml-2 h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground',
        className,
      )}
      data-testid={`column-header-${column.id}`}
      data-sort={sorted || 'none'}
    >
      <span>{title}</span>
      {sorted === 'asc' && <ArrowUp className="ml-2 h-3.5 w-3.5" />}
      {sorted === 'desc' && <ArrowDown className="ml-2 h-3.5 w-3.5" />}
      {!sorted && <ArrowUpDown className="ml-2 h-3.5 w-3.5 opacity-60" />}
    </Button>
  )
}