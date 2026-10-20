import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DashboardTabs } from "@/components/DashboardTabs";
import { LinkFilters } from "@/components/LinkFilters";
import { LinkGrid } from "@/components/LinkGrid";
import { LockedHeader } from "@/components/LockedHeader";
import { PasscodeNotConfigured } from "@/components/PasscodeNotConfigured";
import { SetupProblem } from "@/components/SetupProblem";
import { getAlbumById, listAlbumIdsByLink, listAlbumOptions } from "@/db/albums";
import { getDb } from "@/db/client";
import { countLinks, listDomains, listLinks, type DomainOption } from "@/db/links";
import type { Link } from "@/db/schema";
import {
  formatLinkCount,
  hasActiveFilters,
  resolveLinkFilters,
  type LinkFilters as FilterValues,
} from "@/lib/link-filters";
import { evaluateLockedGate, type LockedGate } from "@/lib/locked-auth";
import { LOCKED_COOKIE_NAME } from "@/lib/locked-session";
import { logEvent } from "@/lib/logger";

// Rendered per request: hidden links must never be cached into a static page.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;
const BASE_PATH = "/locked";

interface AlbumPageData {
  name: string;
  links: Link[];
  domains: DomainOption[];
  total: number;
  albums: { id: string; name: string }[];
  memberships: Map<string, string[]>;
}

type AlbumResult =
  | { kind: "found"; data: AlbumPageData }
  | { kind: "missing" }
  | { kind: "problem"; message: string };

/**
 * Module-scope helper (not a component) so reading the clock and the cookie jar
 * happens outside the render body.
 */
async function readGate(): Promise<LockedGate> {
  const cookieStore = await cookies();

  return evaluateLockedGate({
    sessionToken: cookieStore.get(LOCKED_COOKIE_NAME)?.value,
    configuredPasscode: process.env.LOCKED_PASSCODE,
    now: Date.now(),
  });
}

async function loadAlbum(id: string, filters: FilterValues): Promise<AlbumResult> {
  try {
    const db = getDb();
    const album = await getAlbumById(db, id);

    // An album of the *other* side answers exactly like an unknown id: this page
    // must not confirm that a light album exists, and the URL is guessable.
    if (album === undefined || album.scope !== "locked") {
      return { kind: "missing" };
    }

    // Scoped to *hidden* links, so the dark page shows this side of the album and
    // the light one can never be reached from here.
    const [links, domains, total, albums] = await Promise.all([
      listLinks(db, {
        limit: PAGE_LIMIT,
        albumId: id,
        domain: filters.domain,
        query: filters.query,
        favorite: filters.favorite,
        scope: "locked",
      }),
      listDomains(db, { scope: "locked", albumId: id }),
      countLinks(db, { scope: "locked", albumId: id }),
      listAlbumOptions(db, "locked"),
    ]);

    const memberships = await listAlbumIdsByLink(
      db,
      links.map((link) => link.id),
      "locked",
    );

    return {
      kind: "found",
      data: { name: album.name, links, domains, total, albums, memberships },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("locked_album_load_failed", { album_id: id, message }, "error");

    return {
      kind: "problem",
      message: "This album could not read from the database.",
    };
  }
}

/**
 * The same album as `/albums/[id]`, on the hidden side: dark theme, passcode gate,
 * and only links from locked domains.
 */
export default async function LockedAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const gate = await readGate();

  if (gate.action === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl">
        <PasscodeNotConfigured />
      </main>
    );
  }

  if (gate.action === "prompt") {
    const next = encodeURIComponent(`${BASE_PATH}/albums/${id}`);

    redirect(`${BASE_PATH}/unlock?next=${next}`);
  }

  // Every link on an album page is already inside that album; dropping the field
  // also stops a shared `?album=` URL from changing this page's count line.
  const filters = {
    ...resolveLinkFilters(await searchParams),
    album: "" as const,
  };
  const filtering = hasActiveFilters(filters);
  const result = await loadAlbum(id, filters);

  if (result.kind === "missing") notFound();

  return (
    <main>
      <LockedHeader />

      {result.kind === "problem" ? (
        <>
          <DashboardTabs active="albums" basePath={BASE_PATH} />
          <SetupProblem message={result.message} />
        </>
      ) : (
        <>
          <header className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Album
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
              {result.data.name}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              The links filed here that live in hidden domains. Other links in this
              album are on All links.
            </p>
          </header>

          <DashboardTabs active="albums" basePath={BASE_PATH} />

          {result.data.total > 0 ? (
            <p className="mb-4 text-sm text-slate-500">
              {formatLinkCount(result.data.links.length, result.data.total, filtering)}
            </p>
          ) : null}

          <LinkFilters domains={result.data.domains} filters={filters} />

          {result.data.total === 0 && !filtering ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
              <h2 className="text-base font-semibold text-slate-100">
                No hidden links in this album
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Either nothing is filed here yet, or everything in it lives on
                visible domains, which show on All links.
              </p>
            </div>
          ) : (
            <LinkGrid
              links={result.data.links}
              filters={filters}
              basePath={BASE_PATH}
              locked
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
