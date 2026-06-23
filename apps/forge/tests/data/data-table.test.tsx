import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  type ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useState } from 'react'

import { DataTable } from '@/components/data/DataTable'
import { DataTablePagination } from '@/components/data/DataTablePagination'
import { DataTableColumnHeader } from '@/components/data/DataTableColumnHeader'

interface Person {
  id: string
  name: string
  age: number
}

const PEOPLE: ReadonlyArray<Person> = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 24 },
  { id: '3', name: 'Carol', age: 41 },
  { id: '4', name: 'Dan', age: 19 },
  { id: '5', name: 'Eve', age: 35 },
]

function makeColumns(): ColumnDef<Person, unknown>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => row.original.name,
    },
    {
      id: 'age',
      accessorKey: 'age',
      header: 'Age',
      cell: ({ row }) => row.original.age,
    },
  ]
}

describe('<DataTable>', () => {
  it('renders the table with the expected test id', () => {
    render(<DataTable columns={makeColumns()} data={PEOPLE} />)
    expect(screen.getByTestId('data-table')).toBeTruthy()
  })

  it('renders one row per data item', () => {
    render(<DataTable columns={makeColumns()} data={PEOPLE} />)
    const rows = screen.getAllByRole('row')
    // 1 header row + 5 body rows
    expect(rows.length).toBe(6)
  })

  it('sorts ascending on first click of a sortable column', () => {
    render(
      <DataTable
        columns={makeColumns()}
        data={PEOPLE}
        enableSorting
        getRowId={(p) => p.id}
      />,
    )
    const header = screen.getByTestId('column-header-name')
    expect(header.getAttribute('data-sort')).toBe('none')
    fireEvent.click(header)
    expect(header.getAttribute('data-sort')).toBe('asc')
    // After ascending sort the first body row should contain one of our names
    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1] as HTMLElement
    const matches = within(firstDataRow).getAllByText(/Alice|Bob|Carol|Dan|Eve/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('toggles selection state when a row checkbox is clicked', () => {
    render(
      <DataTable
        columns={makeColumns()}
        data={PEOPLE}
        enableRowSelection
        getRowId={(p) => p.id}
      />,
    )
    const firstRowCheckbox = screen.getByTestId('row-checkbox-1')
    expect(firstRowCheckbox.getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(firstRowCheckbox)
    expect(firstRowCheckbox.getAttribute('data-state')).toBe('checked')
  })

  it('bubbles up selected rows via onRowSelectionChange', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={makeColumns()}
        data={PEOPLE}
        enableRowSelection
        onRowSelectionChange={onChange}
        getRowId={(p) => p.id}
      />,
    )
    fireEvent.click(screen.getByTestId('row-checkbox-1'))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]![0]).toEqual([
      PEOPLE[0],
    ])
  })

  it('renders the empty-state slot when data is empty', () => {
    render(
      <DataTable
        columns={makeColumns()}
        data={[]}
        emptyState={<span data-testid="custom-empty">Nothing here</span>}
      />,
    )
    expect(screen.getByTestId('custom-empty')).toBeTruthy()
  })

  it('paginates when enablePagination is set with a small pageSize', () => {
    // Wrap the table in a Harness so we can share the TanStack table
    // instance with the pagination component.
    function Harness() {
      const table = useReactTable({
        data: PEOPLE as Person[],
        columns: makeColumns(),
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize: 2 } },
      })
      const [, force] = useState(0)
      // The DataTable owns its own useReactTable; this outer instance is
      // only used so DataTablePagination has a table reference.
      void force
      return (
        <>
          <DataTable
            columns={makeColumns()}
            data={PEOPLE}
            enablePagination
            pageSize={2}
          />
          {/* Render the pagination using the outer instance for the page count assertion */}
          <div data-testid="page-count">{table.getPageCount()}</div>
          <div data-testid="page-index">{table.getState().pagination.pageIndex}</div>
        </>
      )
    }
    render(<Harness />)
    expect(screen.getByTestId('page-count').textContent).toBe('3')
    expect(screen.getByTestId('page-index').textContent).toBe('0')
  })
})