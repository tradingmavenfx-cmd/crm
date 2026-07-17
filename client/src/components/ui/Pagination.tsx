'use client';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, pages, total, onPage }: PaginationProps) {
  if (total === 0) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>
        {total} total · page {page} of {Math.max(pages, 1)}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
        >
          Prev
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
