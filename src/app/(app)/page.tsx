import { AddLinkForm } from "@/components/AddLinkForm";
import { AlbumCreateForm } from "@/components/AlbumCreateForm";
import { AlbumGrid } from "@/components/AlbumGrid";
import { AlbumSearch } from "@/components/AlbumSearch";
import { DashboardTabs } from "@/components/DashboardTabs";
import { EmptyState } from "@/components/EmptyState";
import { LinkFilters } from "@/components/LinkFilters";
import { LinkGrid } from "@/components/LinkGrid";
import { SetupProblem } from "@/components/SetupProblem";
import { countAlbums, listAlbumIdsByLink, listAlbumOptions, listAlbums, type AlbumOption, type AlbumSummary } from "@/db/albums";
import { getDb } from "@/db/client";
import { countLinks, listDomains, listLinks, type DomainOption } from "@/db/links";
import type { Link } from "@/db/schema";
import { formatAlbumCount } from "@/lib/albums";
import {
  formatLinkCount,
  hasActiveFilters,
  resolveAlbumQuery,
  resolveLinkFilters,
  resolveTab,
  type DashboardTab,
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
  /** Every album, for the per-card "add to album" popup. */
  albums: AlbumOption[];
  /** Albums per link id, for the same popup's checkboxes. */
  memberships: Map<string, string[]>;
}

interface AlbumsData {
  albums: AlbumSummary[];
  total: number;
}

type TabResult =
  | { kind: "links"; data: DashboardData }
  | { kind: "albums"; data: AlbumsData }
  | { kind: "problem"; message: string };

/**
 * Everything loaded for the Links tab is scoped to *visible* links. Locked domains
 * are filtered inside these queries, so their links, their names, and their counts
 * cannot reach this page at all.
 */
async function loadLinks(filters: FilterValues): Promise<DashboardData> {
  const db = getDb();

  // One round trip each, in parallel: the filtered page, the full domain list
  // (so the dropdown can always switch domains), the unfiltered total, and the
  // albums this page is allowed to offer.
  const [links, domains, total, albums] = await Promise.all([
    listLinks(db, {
      limit: PAGE_LIMIT,
      domain: filters.domain,
      query: filters.query,
      favorite: filters.favorite,
      scope: "visible",
    }),
    listDomains(db, { scope: "visible" }),
    countLinks(db, { scope: "visible" }),
    listAlbumOptions(db, "visible"),
  ]);

  // Then one more query for the whole page's memberships: asking per card would be
  // an N+1, and the ids are only known once the page of links is loaded.
  const memberships = await listAlbumIdsByLink(
    db,
    links.map((link) => link.id),
    "visible",
  );

  return { links, domains, total, albums, memberships };
}

/**
 * The Albums tab, scoped the same way: only the light page's own albums, and their
 * counts and covers only ever consider visible links. A locked album is not this
 * page's to list (see the per-side albums feature).
 */
async function loadAlbums(query: string): Promise<AlbumsData> {
  const db = getDb();

  const [albums, total] = await Promise.all([
    listAlbums(db, { scope: "visible", query, limit: PAGE_LIMIT }),
    countAlbums(db, "visible"),
  ]);

  return { albums, total };
}

async function loadTab(
  tab: DashboardTab,
  filters: FilterValues,
  albumQuery: string,
): Promise<TabResult> {
  try {
    // Only the tab being looked at is queried: the hidden work of the other tab is
    // no work at all.
    return tab === "albums"
      ? { kind: "albums", data: await loadAlbums(albumQuery) }
      : { kind: "links", data: await loadLinks(filters) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("dashboard_load_failed", { tab, message }, "error");

    // Shown to the operator (already behind the dashboard password); a raw stack
    // trace would be worse than a short, actionable message.
    return {
      kind: "problem",
      message: "The dashboard could not read from the database.",
    };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = resolveTab(params);
  const filters = resolveLinkFilters(params);
  const albumQuery = resolveAlbumQuery(params);
  const filtering = hasActiveFilters(filters);
  const result = await loadTab(tab, filters, albumQuery);

  const countLine =
    result.kind === "links" && result.data.total > 0
      ? formatLinkCount(result.data.links.length, result.data.total, filtering)
      : result.kind === "albums" && result.data.total > 0
        ? formatAlbumCount(
            result.data.albums.length,
            result.data.total,
            albumQuery !== "",
          )
        : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {tab === "albums" ? "Albums" : "Links"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {tab === "albums"
              ? "Group links into albums. A link can sit in several albums, and it stays on the Links tab."
              : "Saved from the browser with the Tampermonkey save button, or added by hand below."}
          </p>
        </div>
        {countLine === null ? null : (
          <p className="text-sm text-slate-500">{countLine}</p>
        )}
      </header>

      {/*
        The tab strip is rendered even when the database is unreachable: with two
        views, "nothing here" must not hide the way to the other one.
      */}
      <DashboardTabs active={tab} />

      {result.kind === "problem" ? (
        <SetupProblem message={result.message} />
      ) : result.kind === "albums" ? (
        <>
          <AlbumCreateForm />
          <AlbumSearch query={albumQuery} />
          <AlbumGrid albums={result.data.albums} query={albumQuery} />
        </>
      ) : (
        <>
          <AddLinkForm />

          {/*
            The filter bar is always rendered so the lock button stays reachable
            even when every saved link lives in a hidden domain.
          */}
          <LinkFilters domains={result.data.domains} filters={filters} showLockButton />

          {result.data.total === 0 && !filtering ? (
            <EmptyState />
          ) : (
            <LinkGrid
              links={result.data.links}
              filters={filters}
              albums={result.data.albums}
              memberships={result.data.memberships}
              selectable
            />
          )}
        </>
      )}
    </main>
  );
}
