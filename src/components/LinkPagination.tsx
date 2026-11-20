import Link from "next/link";

import { buildLinksHref, type LinkFilters } from "@/lib/link-filters";

export interface LinkPaginationProps {
  filters: LinkFilters;
  hasMore: boolean;
  basePath?: string;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition";

const BUTTON_ACTIVE = `${BUTTON_BASE} border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100`;

const BUTTON_DISABLED = `${BUTTON_BASE} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-600`;

/**
 * Simple Previous / Page N / Next pagination bar below the link grid or list.
 *
 * Uses the `(limit + 1)` lookahead flag (`hasMore`) from the page query so no
 * extra `COUNT(*)` query is needed to know whether a next page exists. Renders
 * nothing when all results fit on page 1.
 */
export function LinkPagination({
  filters,
  hasMore,
  basePath = "/",
}: LinkPaginationProps) {
  if (filters.page <= 1 && !hasMore) return null;

  const hasPrev = filters.page > 1;
  const prevHref = buildLinksHref(
    { ...filters, page: filters.page - 1 },
    basePath,
  );
  const nextHref = buildLinksHref(
    { ...filters, page: filters.page + 1 },
    basePath,
  );

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {hasPrev ? (
        <Link href={prevHref} className={BUTTON_ACTIVE}>
          Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={BUTTON_DISABLED}>
          Previous
        </span>
      )}

      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
        {`Page ${filters.page}`}
      </span>

      {hasMore ? (
        <Link href={nextHref} className={BUTTON_ACTIVE}>
          Next
        </Link>
      ) : (
        <span aria-disabled="true" className={BUTTON_DISABLED}>
          Next
        </span>
      )}
    </nav>
  );
}
