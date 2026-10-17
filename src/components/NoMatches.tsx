import Link from "next/link";

import { buildLinksHref, type LinkFilters } from "@/lib/link-filters";

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Shown when links exist but none match the current filters. Distinct from
 * `EmptyState`, which is onboarding copy for an account with no links at all.
 */
export function NoMatches({
  filters,
  basePath = "/",
}: {
  filters: LinkFilters;
  basePath?: string;
}) {
  const described = joinParts(
    [
      filters.query === "" ? null : `the search “${filters.query}”`,
      filters.domain === "" ? null : `the domain ${filters.domain}`,
      filters.favorite ? "favorites only" : null,
    ].filter((part): part is string => part !== null),
  );

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        No links match your filters
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
        Nothing matched {described}. Try a different search term, domain, or turn
        off the favorites filter.
      </p>
      <Link
        href={buildLinksHref(
          { query: "", domain: "", favorite: false },
          basePath,
        )}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        Clear filters
      </Link>
    </div>
  );
}
