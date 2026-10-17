import Link from "next/link";

import { buildLinksHref } from "@/lib/link-filters";

/**
 * Shown when links exist but none match the current filters. Distinct from
 * `EmptyState`, which is onboarding copy for an account with no links at all.
 */
export function NoMatches({ query, domain }: { query: string; domain: string }) {
  const described = [
    query === "" ? null : `the search “${query}”`,
    domain === "" ? null : `the domain ${domain}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" and ");

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-base font-semibold text-slate-900">
        No links match your filters
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        Nothing matched {described}. Try a different search term or domain.
      </p>
      <Link
        href={buildLinksHref({ query: "", domain: "" })}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
      >
        Clear filters
      </Link>
    </div>
  );
}
