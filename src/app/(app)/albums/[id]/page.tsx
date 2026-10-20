import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardTabs } from "@/components/DashboardTabs";
import { LinkFilters } from "@/components/LinkFilters";
import { LinkGrid } from "@/components/LinkGrid";
import { SetupProblem } from "@/components/SetupProblem";
import { getAlbumById, listAlbumIdsByLink, listAlbumOptions } from "@/db/albums";
import { getDb } from "@/db/client";
import { countLinks, listDomains, listLinks, type DomainOption } from "@/db/links";
import type { Link as LinkRow } from "@/db/schema";
import {
  formatLinkCount,
  hasActiveFilters,
  resolveLinkFilters,
  type LinkFilters as FilterValues,
} from "@/lib/link-filters";
import { logEvent } from "@/lib/logger";

// Rendered per request: the album must never be served stale from the build cache.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;
const BASE_PATH = "/";

interface AlbumPageData {
  name: string;
  /** Rows, aliased: `Link` is `next/link` in this file. */
  links: LinkRow[];
  domains: DomainOption[];
  total: number;
  albums: { id: string; name: string }[];
  memberships: Map<string, string[]>;
}

async function loadAlbum(
  id: string,
  filters: FilterValues,
): Promise<
  | { kind: "found"; data: AlbumPageData }
  | { kind: "missing" }
  | { kind: "problem"; message: string }
> {
  try {
    const db = getDb();
    const album = await getAlbumById(db, id);

    // An unknown id — a typo, or an album deleted while the page was open — is a
    // 404, never a database error and never a blank page. An album of the *other*
    // side answers the same way: the light page must not even confirm it exists.
    if (album === undefined || album.scope !== "visible") {
      return { kind: "missing" };
    }

    // Scoped to *visible* links: opening an album can never surface a hidden link.
    const [links, domains, total, albums] = await Promise.all([
      listLinks(db, {
        limit: PAGE_LIMIT,
        albumId: id,
        domain: filters.domain,
        query: filters.query,
        favorite: filters.favorite,
        scope: "visible",
      }),
      listDomains(db, { scope: "visible", albumId: id }),
      countLinks(db, { scope: "visible", albumId: id }),
      listAlbumOptions(db, "visible"),
    ]);

    const memberships = await listAlbumIdsByLink(
      db,
      links.map((link) => link.id),
      "visible",
    );

    return {
      kind: "found",
      data: { name: album.name, links, domains, total, albums, memberships },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("dashboard_album_load_failed", { album_id: id, message }, "error");

    return {
      kind: "problem",
      message: "This album could not read from the database.",
    };
  }
}

/**
 * One album's links, with the full filter set applied inside it.
 *
 * It lives in the `(app)` route group, so it keeps the dashboard's navbar while
 * staying at `/albums/<id>`; the dark twin is `/locked/albums/<id>`.
 */
export default async function AlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Every link on an album page is already inside that album, so the membership
  // filter has nothing to say here. Dropping the field also stops a shared
  // `?album=` URL from changing this page's count line.
  const filters = {
    ...resolveLinkFilters(await searchParams),
    album: "" as const,
  };
  const filtering = hasActiveFilters(filters);
  const result = await loadAlbum(id, filters);

  if (result.kind === "missing") notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Album
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {result.kind === "found" ? result.data.name : "Album"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Every link here also stays on the Links tab.
          </p>
        </div>
        {result.kind === "found" && result.data.total > 0 ? (
          <p className="text-sm text-slate-500">
            {formatLinkCount(result.data.links.length, result.data.total, filtering)}
          </p>
        ) : null}
      </header>

      <DashboardTabs active="albums" basePath={BASE_PATH} />

      {result.kind === "problem" ? (
        <SetupProblem message={result.message} />
      ) : (
        <>
          <LinkFilters
            domains={result.data.domains}
            filters={filters}
            showLockButton
          />

          {result.data.total === 0 && !filtering ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <h2 className="text-base font-semibold text-slate-900">
                Nothing in this album yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Open the Links tab and use the folder button on any card to file it
                here.
              </p>
              <Link
                href={BASE_PATH}
                className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Go to Links
              </Link>
            </div>
          ) : (
            <LinkGrid
              links={result.data.links}
              filters={filters}
              basePath={BASE_PATH}
              albums={result.data.albums}
              memberships={result.data.memberships}
              removeFromAlbumId={id}
            />
          )}
        </>
      )}
    </main>
  );
}
