/**
 * Data primitives barrel.
 *
 * Re-exports the typed DataTable family + EmptyState so consumers
 * can write `import { DataTable, DataTableToolbar, EmptyState } from
 * '@/components/data'`.
 */
export { DataTable } from './DataTable'
export type { DataTableProps } from './DataTable'
export { DataTableColumnHeader } from './DataTableColumnHeader'
export type { DataTableColumnHeaderProps } from './DataTableColumnHeader'
export { DataTableRowCheckbox } from './DataTableRowCheckbox'
export type { DataTableRowCheckboxProps } from './DataTableRowCheckbox'
export { DataTablePagination } from './DataTablePagination'
export type { DataTablePaginationProps } from './DataTablePagination'
export { DataTableToolbar } from './DataTableToolbar'
export type { DataTableToolbarProps } from './DataTableToolbar'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'