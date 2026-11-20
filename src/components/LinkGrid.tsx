import Link from "next/link";

import { LinkCard } from "@/components/LinkCard";
import { LinkList } from "@/components/LinkList";
import { LinkPagination } from "@/components/LinkPagination";
import { NoMatches } from "@/components/NoMatches";
import { SelectAllToggle } from "@/components/SelectAllToggle";
import { SelectionBar } from "@/components/SelectionBar";
import { SelectionProvider } from "@/components/SelectionProvider";
import type { AlbumOption } from "@/db/albums";
import type { Link as LinkRow } from "@/db/schema";
import { buildLinksHref, type LinkFilters } from "@/lib/link-filters";

export interface LinkGridProps {
  links: readonly LinkRow[];
  filters: LinkFilters;
  /** True when another page of links exists after the current page. */
  hasMore?: boolean;
  /** Where "Clear filters" points, and how the cards label themselves. */
  basePath?: string;
  /** True on the dark locked page, so the cards can send expired passcodes back. */
  locked?: boolean;
  /** Every album, for the per-card "add to album" popup. */
  albums?: readonly AlbumOption[];
  /** Albums per link id; a link that is in none is simply absent. */
  memberships?: ReadonlyMap<string, readonly string[]>;
  /** Set on an album's page, so its cards can take the link out again. */
  removeFromAlbumId?: string;
  /**
   * Turns the grid into a multi-select surface: a checkbox per card, "select all",
   * and the bulk action bar. Only the Links tabs ask for it — an album's page has
   * nothing to file its own links into.
   */
  selectable?: boolean;
}

/**
 * The card grid and its "nothing matched" state, shared by the dashboard and the
 * locked page so the two can never drift apart.
 *
 * `filters.view` picks the layout: the card grid or the detailed list. Both live
 * inside the same selection provider, so bulk selection behaves identically.
 */
export function LinkGrid({
  links,
  filters,
  hasMore = false,
  basePath = "/",
  locked = false,
  albums,
  memberships,
  removeFromAlbumId,
  selectable = false,
}: LinkGridProps) {
  if (links.length === 0) {
    if (filters.page > 1) {
      return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            No links on page {filters.page}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            You have gone past the last page of results.
          </p>
          <Link
            href={buildLinksHref({ ...filters, page: 1 }, basePath)}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Back to page 1
          </Link>
        </div>
      );
    }

    return <NoMatches filters={filters} albums={albums} basePath={basePath} />;
  }

  const visibleIds = links.map((link) => link.id);
  const pagination = (
    <LinkPagination filters={filters} hasMore={hasMore} basePath={basePath} />
  );

  const body =
    filters.view === "list" ? (
      <>
        <LinkList
          links={links}
          locked={locked}
          albums={albums}
          memberships={memberships}
          removeFromAlbumId={removeFromAlbumId}
          basePath={basePath}
        />
        {pagination}
      </>
    ) : (
      <>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {links.map((link) => (
            <li key={link.id}>
              <LinkCard
                link={link}
                locked={locked}
                albums={albums}
                memberAlbumIds={memberships?.get(link.id) ?? []}
                removeFromAlbumId={removeFromAlbumId}
                basePath={basePath}
              />
            </li>
          ))}
        </ul>
        {pagination}
      </>
    );

  if (!selectable) return body;

  return (
    <SelectionProvider>
      <SelectAllToggle visibleIds={visibleIds} />

      {/*
        Room for the fixed action bar, so the last row's buttons are never covered
        by it while a selection exists.
      */}
      <div className="pb-24">{body}</div>

      {/*
        `albums` is undefined on the album pages, where nothing is selectable; the
        bar needs them only in the tabs that pass `selectable`.
      */}
      <SelectionBar
        albums={albums ?? []}
        visibleIds={visibleIds}
        locked={locked}
      />
    </SelectionProvider>
  );
}
