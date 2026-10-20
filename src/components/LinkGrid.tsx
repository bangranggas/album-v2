import { LinkCard } from "@/components/LinkCard";
import { NoMatches } from "@/components/NoMatches";
import { SelectAllToggle } from "@/components/SelectAllToggle";
import { SelectionBar } from "@/components/SelectionBar";
import { SelectionProvider } from "@/components/SelectionProvider";
import type { AlbumOption } from "@/db/albums";
import type { Link } from "@/db/schema";
import type { LinkFilters } from "@/lib/link-filters";

export interface LinkGridProps {
  links: readonly Link[];
  filters: LinkFilters;
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
 */
export function LinkGrid({
  links,
  filters,
  basePath = "/",
  locked = false,
  albums,
  memberships,
  removeFromAlbumId,
  selectable = false,
}: LinkGridProps) {
  if (links.length === 0) {
    return <NoMatches filters={filters} basePath={basePath} />;
  }

  const visibleIds = links.map((link) => link.id);

  const grid = (
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
  );

  if (!selectable) return grid;

  return (
    <SelectionProvider>
      <SelectAllToggle visibleIds={visibleIds} />

      {/*
        Room for the fixed action bar, so the last row's buttons are never covered
        by it while a selection exists.
      */}
      <div className="pb-24">{grid}</div>

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
