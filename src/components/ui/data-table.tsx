"use client";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
// RTL: `dir="rtl"` reorders the DOM but does NOT rotate an icon glyph, so the
// pagination chevrons carry `rtl:rotate-180` explicitly. Same rule applies to
// every directional icon added later (SPEC §10.1).
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export interface Column<T> {
  key: string;
  label: string;
  headerRender?: () => React.ReactNode; // custom header cell
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DataTableProps<T extends object = any> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (p: number) => void;
  onLimitChange: (l: number) => void;
  onSort?: (field: string, order: "asc" | "desc") => void;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  loading?: boolean;
  emptyMessage?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRowClick?: (row: T) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends object = any>({
  columns,
  data,
  total,
  page,
  limit,
  onPageChange,
  onLimitChange,
  onSort,
  sortField,
  sortOrder,
  loading,
  emptyMessage = "No records found",
  onRowClick,
}: DataTableProps<T>) {
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const handleSort = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    const newOrder =
      sortField === col.key && sortOrder === "asc" ? "desc" : "asc";
    onSort(col.key, newOrder);
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-start font-medium text-slate-600 whitespace-nowrap",
                    col.sortable && "cursor-pointer select-none hover:text-slate-900",
                    col.className
                  )}
                  onClick={() => handleSort(col)}
                >
                  <div className="flex items-center gap-1">
                    {col.headerRender ? col.headerRender() : col.label}
                    {col.sortable && (
                      <span className="flex flex-col ms-1">
                        <ChevronUp
                          size={10}
                          className={cn(
                            sortField === col.key && sortOrder === "asc"
                              ? "text-sky-500"
                              : "text-slate-300"
                          )}
                        />
                        <ChevronDown
                          size={10}
                          className={cn(
                            sortField === col.key && sortOrder === "desc"
                              ? "text-sky-500"
                              : "text-slate-300"
                          )}
                        />
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-slate-100 hover:bg-slate-50 last:border-0",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3", col.className)}>
                      {col.render
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ? col.render(row)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        : String((row as any)[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Rows per page:</span>
          <Select
            value={String(limit)}
            onValueChange={(v) => onLimitChange(Number(v))}
          >
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
              <SelectItem value="9999">All</SelectItem>
            </SelectContent>
          </Select>
          <span>
            {start}–{end} of {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(1)}
            disabled={page === 1}
          >
            <ChevronsLeft size={14} className="rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
          >
            <ChevronLeft size={14} className="rtl:rotate-180" />
          </Button>
          <span className="px-3 py-1 text-sm text-slate-600">
            {page} / {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight size={14} className="rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
          >
            <ChevronsRight size={14} className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
