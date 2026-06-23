'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'

import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DataTableRowCheckbox } from './DataTableRowCheckbox'

/**
 * DataTable — typed generic table built on TanStack Table v8 + shadcn Table.
 *
 * Composition:
 *   - Optional toolbar slot above the table (search + filter + sort)
 *   - Optional pagination slot below the table
 *   - Optional empty-state slot when data is empty
 *
 * Consumers pass their own column definitions via `ColumnDef<TData, TValue>`.
 * Row selection is enabled via `enableRowSelection`; pagination via
 * `enablePagination`. The `onRowSelectionChange` callback receives the
 * selected rows (the original TData objects, in selection order).
 */
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: ReadonlyArray<TData>
  enableSorting?: boolean
  enableRowSelection?: boolean | ((row: TData) => boolean)
  enablePagination?: boolean
  pageSize?: number
  initialSorting?: SortingState
  toolbar?: React.ReactNode
  pagination?: React.ReactNode
  emptyState?: React.ReactNode
  onRowSelectionChange?: (rows: TData[]) => void
  className?: string
  /** rowKey accessor; defaults to `row.id` (TanStack row id). */
  getRowId?: (row: TData, index: number) => string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  enableSorting = false,
  enableRowSelection = false,
  enablePagination = false,
  pageSize = 10,
  initialSorting = [],
  toolbar,
  pagination,
  emptyState,
  onRowSelectionChange,
  className,
  getRowId,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  // Detect the row-id accessor. If the caller passes getRowId we use it
  // as TanStack's getRowId for stable selection state across renders.
  const tanstackGetRowId = React.useMemo(
    () => (getRowId ? (row: TData, index: number) => getRowId(row, index) : undefined),
    [getRowId],
  )

  const table = useReactTable<TData>({
    data: data as TData[],
    columns,
    state: { sorting, rowSelection },
    enableSorting,
    enableRowSelection: enableRowSelection as
      | boolean
      | ((row: import('@tanstack/react-table').Row<TData>) => boolean)
      | undefined,
    getRowId: tanstackGetRowId,
    onSortingChange: setSorting,
    onRowSelectionChange: (
      updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState),
    ) => {
      setRowSelection((old) =>
        typeof updater === 'function'
          ? (updater as (old: RowSelectionState) => RowSelectionState)(old)
          : updater,
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableRowSelection !== false ? getFilteredRowModel() : undefined,
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    initialState: enablePagination ? { pagination: { pageSize } } : undefined,
  })

  // Bubble up selection changes
  React.useEffect(() => {
    if (!onRowSelectionChange) return
    const selected = table
      .getSelectedRowModel()
      .rows.map((r) => r.original)
    onRowSelectionChange(selected)
  }, [rowSelection, onRowSelectionChange, table])

  const rows = table.getRowModel().rows
  const showRowSelectionColumn = enableRowSelection !== false

  return (
    <div data-testid="data-table" className={cn('space-y-3', className)}>
      {toolbar}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {showRowSelectionColumn && (
                  <TableHead className="w-10">
                    <DataTableRowCheckbox
                      row={
                        // TanStack's "header row" is not selectable; we pass
                        // a synthetic row-like object so the same UI renders
                        // for the indeterminate "select all" affordance.
                        ({
                          getIsSelected: () => table.getIsAllRowsSelected(),
                          getIsSomeSelected: () => table.getIsSomeRowsSelected(),
                          getCanSelect: () =>
                            table.getRowModel().rows.some((r) => r.getCanSelect()),
                          getToggleSelectedHandler: () => () => table.toggleAllRowsSelected(),
                          id: '__header__',
                        } as unknown as Parameters<typeof DataTableRowCheckbox>[0]['row'])
                      }
                    />
                  </TableHead>
                )}
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (showRowSelectionColumn ? 1 : 0)}
                  className="h-24 text-center text-13 text-muted-foreground"
                >
                  {emptyState ?? 'No results.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                >
                  {showRowSelectionColumn && (
                    <TableCell>
                      <DataTableRowCheckbox row={row} />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination}
    </div>
  )
}

/**
 * enableRowModel — small helper that returns the appropriate row model
 * for filtering when row selection is on (TanStack needs the filtered
 * model to compute selection correctly across pages).
 *
 * NOTE: TanStack Table v8 requires the filtered model to be active
 * whenever row selection is enabled, so we always set it here when
 * selection is on (regardless of whether a `getFilteredRowModel`
 * filter has been explicitly configured by the caller).
 */