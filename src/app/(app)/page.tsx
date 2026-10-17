import { EmptyState } from "@/components/EmptyState";
import { LinkCard } from "@/components/LinkCard";
import { LinkFilters } from "@/components/LinkFilters";
import { NoMatches } from "@/components/NoMatches";
import { SetupProblem } from "@/components/SetupProblem";
import { getDb } from "@/db/client";
import { countLinks, listDomains, listLinks, type DomainOption } from "@/db/links";
import type { Link } from "@/db/schema";
import {
  hasActiveFilters,
  resolveLinkFilters,
  type LinkFilters as FilterValues,
} from "@/lib/link-filters";
import { logEvent } from "@/lib/logger";

// Rendered per request: the list must never be served stale from the build cache.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;

interface DashboardData {
  links: Link[];
  domains: DomainOption[];
  total: number;
}

async function loadDashboard(
  filters: FilterValues,
): Promise<{ data: DashboardData; problem?: undefined } | { data?: undefined; problem: string }> {
  try {
    const db = getDb();

    // One round trip each, in parallel: the filtered page, the full domain list
    // (so the dropdown can always switch domains), and the unfiltered total.
    const [links, domains, total] = await Promise.all([
      listLinks(db, {
        limit: PAGE_LIMIT,
        domain: filters.domain,
        query: filters.query,
      }),
      listDomains(db),
      countLinks(db),
    ]);

    return { data: { links, domains, total } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("dashboard_load_failed", { message }, "error");

    // Shown to the operator (already behind the dashboard password); a raw stack
    // trace would be worse than a short, actionable message.
    return { problem: "The dashboard could not read from the database." };
  }
}

function countLabel(shown: number, total: number, filtering: boolean): string {
  const noun = total === 1 ? "link" : "links";

  if (!filtering) return `${shown} ${noun}`;

  return `${shown} of ${total} ${noun}`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = resolveLinkFilters(await searchParams);
  const filtering = hasActiveFilters(filters);
  const { data, problem } = await loadDashboard(filters);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Links
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Saved from the browser with the Tampermonkey save button.
          </p>
        </div>
        {data !== undefined && data.total > 0 ? (
          <p className="text-sm text-slate-500">
            {countLabel(data.links.length, data.total, filtering)}
          </p>
        ) : null}
      </header>

      {problem !== undefined ? (
        <SetupProblem message={problem} />
      ) : data.total === 0 && !filtering ? (
        // Nothing saved yet: onboarding copy is more useful than a filter bar.
        <EmptyState />
      ) : (
        <>
          <LinkFilters
            domains={data.domains}
            query={filters.query}
            domain={filters.domain}
          />

          {data.links.length === 0 ? (
            <NoMatches query={filters.query} domain={filters.domain} />
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.links.map((link) => (
                <li key={link.id}>
                  <LinkCard link={link} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
