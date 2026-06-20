import type { JSX } from "react";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { cn } from "../tokens/cn";

export interface TypedTableColumn<T> {
  /** Stable id for the column (used as key + accessor key fallback). */
  readonly id: string;
  /** Header label. */
  readonly header: string;
  /** Optional accessor — pull a value from the row. Defaults to `row[id]`. */
  readonly accessor?: (row: T) => unknown;
  /** Optional custom cell renderer. */
  readonly cell?: (value: unknown, row: T) => JSX.Element | string | number | null;
  /** Right-align numeric columns. */
  readonly numeric?: boolean;
  /** Disable sorting on this column. */
  readonly disableSort?: boolean;
}

export interface TypedTableProps<T> {
  readonly data: ReadonlyArray<T>;
  readonly columns: ReadonlyArray<TypedTableColumn<T>>;
  readonly ariaLabel: string;
  /** Initial page size. Default 25. */
  readonly initialPageSize?: number;
  className?: string;
}

/**
 * TypedTable<T> — Plan 4 §7 typed TanStack Table wrapper. Sort, paginate, and
 * render row-by-row. Defaults to 25 rows per page; the 10k-row AC is verified
 * in __tests__/typed-table.perf.test.ts.
 *
 * A typed list view that does not use TypedTable is a review blocker.
 */
export function TypedTable<T>({
  data,
  columns,
  ariaLabel,
  initialPageSize = 25,
  className,
}: TypedTableProps<T>): JSX.Element {
  const tableColumns = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map<ColumnDef<T, unknown>>((c) => {
        const accessor = c.accessor ?? ((row: T) => (row as Record<string, unknown>)[c.id]);
        const def: ColumnDef<T, unknown> = {
          id: c.id,
          header: c.header,
          accessorFn: accessor,
          cell: (info) => {
            const v = info.getValue();
            if (c.cell) return c.cell(v, info.row.original);
            if (v === null || v === undefined) return "—";
            if (typeof v === "string" || typeof v === "number") return v;
            return JSON.stringify(v);
          },
          enableSorting: !c.disableSort,
          sortingFn: c.numeric ? "basic" : "alphanumeric",
        };
        return def;
      }),
    [columns],
  );

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable<T>({
    data: data as T[],
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  const rowCount = data.length;

  return (
    <div className={cn("overflow-x-auto rounded-md border border-surface-border bg-surface", className)}>
      <table aria-label={ariaLabel} className="w-full text-body-sm">
        <thead className="bg-surface-raised text-left">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-surface-border">
              {hg.headers.map((h) => {
                const col = columns.find((c) => c.id === h.column.id);
                const isNumeric = col?.numeric === true;
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={
                      h.column.getIsSorted() === "asc"
                        ? "ascending"
                        : h.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={cn(
                      "px-3 py-2 text-caption font-medium text-ink-muted",
                      isNumeric && "text-right",
                    )}
                  >
                    {h.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 text-ink-muted hover:text-ink-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: "▲", desc: "▼" }[h.column.getIsSorted() as string] ?? ""}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className="border-b border-surface-border last:border-b-0 hover:bg-surface-sunken">
              {r.getVisibleCells().map((cell) => {
                const col = columns.find((c) => c.id === cell.column.id);
                return (
                  <td
                    key={cell.id}
                    className={cn("px-3 py-2 text-ink-default", col?.numeric && "text-right font-mono")}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {rowCount === 0 && <TypedTableEmptyState />}

      {rowCount > initialPageSize && (
        <div
          role="navigation"
          aria-label="Table pagination"
          className="flex items-center justify-between border-t border-surface-border px-3 py-2 text-caption text-ink-muted"
        >
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="rounded-sm border border-surface-border bg-surface px-2 py-1 hover:bg-surface-sunken disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="rounded-sm border border-surface-border bg-surface px-2 py-1 hover:bg-surface-sunken disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TypedTableEmptyState — Plan 4 §7. Shown when the row set is empty so users
 * don't stare at a blank table.
 */
export function TypedTableEmptyState(): JSX.Element {
  return (
    <div
      role="status"
      className="border-t border-surface-border bg-surface-sunken px-4 py-8 text-center"
    >
      <p className="text-body-sm text-ink-muted">No rows to display.</p>
    </div>
  );
}

/**
 * TypedTableToolbar — Plan 4 §7. Filter + export bar. Filter is in-memory on
 * the supplied predicate; export wires to a `toCsv` helper.
 */
export interface TypedTableToolbarProps {
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly onExport?: () => void;
  readonly exportLabel?: string;
  readonly filterPlaceholder?: string;
  className?: string;
}

export function TypedTableToolbar({
  query,
  onQueryChange,
  onExport,
  exportLabel = "Export CSV",
  filterPlaceholder = "Filter…",
  className,
}: TypedTableToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Table toolbar"
      className={cn("flex items-center justify-between gap-2 border-b border-surface-border bg-surface-raised px-3 py-2", className)}
    >
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={filterPlaceholder}
        aria-label="Filter rows"
        className="h-8 w-64 rounded-sm border border-surface-border bg-surface px-2 text-body-sm text-ink-default placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          className="h-8 rounded-sm border border-surface-border bg-surface px-3 text-body-sm text-ink-default hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {exportLabel}
        </button>
      )}
    </div>
  );
}

/**
 * toCsv — Plan 4 §7 helper. Stringifies a tabular dataset for export.
 * Quote-escapes commas, quotes, and newlines per RFC 4180.
 */
export function toCsv<T>(rows: ReadonlyArray<T>, columns: ReadonlyArray<TypedTableColumn<T>>): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = c.accessor ? c.accessor(r) : (r as Record<string, unknown>)[c.id];
        return csvEscape(v === null || v === undefined ? "" : String(v));
      })
      .join(","),
  );
  return [header, ...lines].join("\n");
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
