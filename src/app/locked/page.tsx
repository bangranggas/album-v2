import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AddLinkForm } from "@/components/AddLinkForm";
import { AlbumCreateForm } from "@/components/AlbumCreateForm";
import { AlbumGrid } from "@/components/AlbumGrid";
import { AlbumSearch } from "@/components/AlbumSearch";
import { DashboardTabs } from "@/components/DashboardTabs";
import { LinkFilters } from "@/components/LinkFilters";
import { LinkGrid } from "@/components/LinkGrid";
import { LockedDomainsPanel } from "@/components/LockedDomainsPanel";
import { LockedHeader } from "@/components/LockedHeader";
import { PasscodeNotConfigured } from "@/components/PasscodeNotConfigured";
import { SetupProblem } from "@/components/SetupProblem";
import { countAlbums, listAlbumIdsByLink, listAlbumOptions, listAlbums, type AlbumOption, type AlbumSummary } from "@/db/albums";
import { getDb } from "@/db/client";
import {
  countLinks,
  listAllDomains,
  listDomains,
  listLinks,
  type DomainOption,
} from "@/db/links";
import { listLockedDomains, type LockedDomainOption } from "@/db/locked-domains";
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
import { evaluateLockedGate, type LockedGate } from "@/lib/locked-auth";
import { LOCKED_COOKIE_NAME } from "@/lib/locked-session";
import { logEvent } from "@/lib/logger";

// Rendered per request: hidden links must never be cached into a static page.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;
const BASE_PATH = "/locked";

interface LockedData {
  links: Link[];
  /** Domains that hold hidden links, for the dropdown. */
  domains: DomainOption[];
  /** The locked list itself, with counts, for the management panel. */
  lockedDomains: LockedDomainOption[];
  /** Every domain with links, as suggestions when locking a new one. */
  suggestions: string[];
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
  | { kind: "links"; data: LockedData }
  | { kind: "albums"; data: AlbumsData }
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

async function loadLinks(filters: FilterValues): Promise<LockedData> {
  const db = getDb();

  const [links, domains, lockedDomains, allDomains, total, albums] = await Promise.all([
    listLinks(db, {
      limit: PAGE_LIMIT,
      domain: filters.domain,
      query: filters.query,
      favorite: filters.favorite,
      albumMembership: filters.album === "" ? undefined : filters.album,
      scope: "locked",
    }),
    listDomains(db, { scope: "locked" }),
    listLockedDomains(db),
    listAllDomains(db),
    countLinks(db, { scope: "locked" }),
    listAlbumOptions(db, "locked"),
  ]);

  // One query for the whole page's memberships, rather than one per card.
  const memberships = await listAlbumIdsByLink(
    db,
    links.map((link) => link.id),
    "locked",
  );

  return {
    links,
    domains,
    lockedDomains,
    suggestions: allDomains.map((option) => option.domain),
    total,
    albums,
    memberships,
  };
}

/**
 * The albums of the hidden area: its own list, counted and covered from the hidden
 * side only. An album created here lives here; the light page never lists it, and
 * this page never lists a light album.
 */
async function loadAlbums(query: string): Promise<AlbumsData> {
  const db = getDb();

  const [albums, total] = await Promise.all([
    listAlbums(db, { scope: "locked", query, limit: PAGE_LIMIT }),
    countAlbums(db, "locked"),
  ]);

  return { albums, total };
}

async function loadTab(
  tab: DashboardTab,
  filters: FilterValues,
  albumQuery: string,
): Promise<TabResult> {
  try {
    return tab === "albums"
      ? { kind: "albums", data: await loadAlbums(albumQuery) }
      : { kind: "links", data: await loadLinks(filters) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("locked_dashboard_load_failed", { tab, message }, "error");

    return {
      kind: "problem",
      message: "The hidden list could not read from the database.",
    };
  }
}

/**
 * The hidden dashboard: the same list, the same filters, the same tabs, and the
 * same card actions as `/`, but scoped to locked domains and behind the passcode.
 */
export default async function LockedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await readGate();

  if (gate.action === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl">
        <PasscodeNotConfigured />
      </main>
    );
  }

  if (gate.action === "prompt") {
    redirect(`${BASE_PATH}/unlock?next=%2Flocked`);
  }

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
    <main>
      <LockedHeader />

      {/*
        Rendered before the content, so the way back to the other tab is always
        there — including in the "no hidden links yet" state below.
      */}
      <DashboardTabs active={tab} basePath={BASE_PATH} />

      {result.kind === "problem" ? (
        <SetupProblem message={result.message} />
      ) : result.kind === "albums" ? (
        <>
          {countLine === null ? null : (
            <p className="mb-4 text-sm text-slate-500">{countLine}</p>
          )}
          <AlbumCreateForm locked />
          <AlbumSearch query={albumQuery} />
          <AlbumGrid albums={result.data.albums} basePath={BASE_PATH} locked query={albumQuery} />
        </>
      ) : (
        <>
          <LockedDomainsPanel
            domains={result.data.lockedDomains}
            suggestions={result.data.suggestions}
          />

          {countLine === null ? null : (
            <p className="mb-4 text-sm text-slate-500">{countLine}</p>
          )}

          <AddLinkForm
            lockedDomains={result.data.lockedDomains.map((entry) => entry.domain)}
          />

          {result.data.total === 0 && !filtering ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center">
              <h2 className="text-base font-semibold text-slate-100">
                No hidden links yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Lock a domain above and every link saved to it moves here. You can
                also add a link by hand.
              </p>
            </div>
          ) : (
            <>
              <LinkFilters
                domains={result.data.domains}
                filters={filters}
                showAlbumFilter
              />
              <LinkGrid
                links={result.data.links}
                filters={filters}
                basePath={BASE_PATH}
                locked
                albums={result.data.albums}
                memberships={result.data.memberships}
                selectable
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
