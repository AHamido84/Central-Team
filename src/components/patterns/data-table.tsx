'use client';

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Rows3, Search, SearchX, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Card, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

export type DataTableFilter = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
};

const multiValue: FilterFn<unknown> = (row, columnId, value: string) => {
  if (!value) return true;
  const cell = row.getValue(columnId);
  return Array.isArray(cell) ? cell.includes(value) : String(cell) === value;
};

/**
 * Data table (UI.md §5): search, filters, sorting, column visibility, row selection with bulk bar,
 * pagination, density toggle; renders `mobileCard` below `md` instead of a cramped table.
 */
export function DataTable<T>({
  data,
  columns,
  searchPlaceholder,
  searchFn,
  filters = [],
  toolbar,
  bulkActions,
  mobileCard,
  emptyState,
  pageSize = 20,
  getRowId,
  onRowClick,
  testId,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  searchPlaceholder?: string;
  searchFn?: (row: T, query: string) => boolean;
  filters?: DataTableFilter[];
  toolbar?: ReactNode;
  bulkActions?: (rows: T[], clear: () => void) => ReactNode;
  mobileCard?: (row: T) => ReactNode;
  emptyState?: ReactNode;
  pageSize?: number;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  testId?: string;
}) {
  const t = useTranslations('common');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<{ id: string; value: string }[]>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [compact, setCompact] = useState(false);

  const selectionColumn: ColumnDef<T, unknown> = {
    id: '__select',
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label={t('all')}
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={row.id}
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
        onClick={(e) => e.stopPropagation()}
      />
    ),
  };

  const table = useReactTable({
    data,
    columns: bulkActions ? [selectionColumn, ...columns] : columns,
    state: { sorting, globalFilter, columnFilters, columnVisibility, rowSelection },
    getRowId,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters as never,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: (row, _columnId, value: string) => (searchFn ? searchFn(row.original, value.toLowerCase()) : true),
    filterFns: { multiValue },
    defaultColumn: { filterFn: multiValue as FilterFn<T> },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const filtered = Boolean(globalFilter) || columnFilters.length > 0;
  const pageCount = table.getPageCount();

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {searchFn ? (
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder ?? t('searchPlaceholder')}
              className="ps-9"
              aria-label={t('search')}
              data-testid={testId ? `${testId}-search` : undefined}
            />
          </div>
        ) : null}
        {filters.map((f) => (
          <div key={f.id} className="sm:w-44">
            <NativeSelect
              aria-label={f.label}
              value={(columnFilters.find((c) => c.id === f.id)?.value as string) ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                setColumnFilters((prev) => [...prev.filter((c) => c.id !== f.id), ...(value ? [{ id: f.id, value }] : [])]);
              }}
            >
              <option value="">{`${f.label}: ${t('all')}`}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGlobalFilter('');
              setColumnFilters([]);
            }}
          >
            <X />
            {t('clearFilters')}
          </Button>
        ) : null}
        <div className="flex items-center gap-2 sm:ms-auto">
          {toolbar}
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={() => setCompact((c) => !c)}
            aria-label={t('density')}
            aria-pressed={compact}
          >
            <Rows3 />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" aria-label={t('columns')}>
                <Columns3 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t('columns')}</DropdownMenuLabel>
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={(e) => {
                      e.preventDefault();
                      c.toggleVisibility();
                    }}
                  >
                    <Checkbox checked={c.getIsVisible()} className="pointer-events-none" />
                    {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {bulkActions && selected.length > 0 ? (
        <div className="flex animate-fade-in flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-4 py-2 text-sm">
          <span className="font-medium text-primary-soft-foreground">{t('rowsSelected', { count: selected.length })}</span>
          <span className="ms-auto flex flex-wrap gap-2">{bulkActions(selected, () => setRowSelection({}))}</span>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title={t('noResults')} description={t('noResultsHint')} compact />
          ) : (
            (emptyState ?? <EmptyState icon={SearchX} title={t('noResults')} compact />)
          )
        ) : (
          <>
            {mobileCard ? (
              <ul className="divide-y divide-border md:hidden">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className={cn(onRowClick && 'cursor-pointer active:bg-surface-muted')}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {mobileCard(row.original)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={cn('overflow-x-auto', mobileCard && 'hidden md:block')}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-surface-muted/60 text-xs text-muted-foreground">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((header) => {
                        const sort = header.column.getIsSorted();
                        return (
                          <th
                            key={header.id}
                            className={cn('h-10 px-4 text-start font-medium whitespace-nowrap', header.id === '__select' && 'w-10')}
                          >
                            {header.isPlaceholder ? null : header.column.getCanSort() ? (
                              <button
                                type="button"
                                onClick={header.column.getToggleSortingHandler()}
                                className="inline-flex items-center gap-1 hover:text-foreground"
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sort === 'asc' ? (
                                  <ArrowUp className="size-3.5" />
                                ) : sort === 'desc' ? (
                                  <ArrowDown className="size-3.5" />
                                ) : (
                                  <ChevronsUpDown className="size-3.5 opacity-50" />
                                )}
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      onClick={() => onRowClick?.(row.original)}
                      className={cn(
                        'transition-colors hover:bg-surface-muted/60 data-[state=selected]:bg-primary-soft/50',
                        onRowClick && 'cursor-pointer',
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className={cn('px-4 align-middle', compact ? 'h-9' : 'h-(--row-h) py-2')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{t('pageOf', { page: table.getState().pagination.pageIndex + 1, pages: pageCount })}</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={t('previousPage')}
            >
              <DirIcon icon={ChevronLeft} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={t('nextPage')}
            >
              <DirIcon icon={ChevronRight} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
