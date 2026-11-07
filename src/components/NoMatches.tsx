import Link from "next/link";

import type { AlbumOption } from "@/db/albums";
import {
  buildLinksHref,
  clearLinkFilters,
  type LinkFilters,
} from "@/lib/link-filters";

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function joinValues(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";

  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function albumNames(
  ids: readonly string[],
  albums: readonly AlbumOption[] | undefined,
): string[] {
  return ids.map(
    (id) => albums?.find((album) => album.id === id)?.name ?? id,
  );
}

/**
 * Shown when links exist but none match the current filters. Distinct from
 * `EmptyState`, which is onboarding copy for an account with no links at all.
 *
 * The clear link keeps the chosen grid/list view: the view is not a filter, so
 * "Clear filters" should not also undo it.
 */
export function NoMatches({
  filters,
  albums,
  basePath = "/",
}: {
  filters: LinkFilters;
  /** The page's own albums, so ids can be described by name. */
  albums?: readonly AlbumOption[];
  basePath?: string;
}) {
  const domainIncludes = filters.domains.include;
  const domainExcludes = filters.domains.exclude;
  const albumIncludes = filters.albumNone
    ? []
    : albumNames(filters.albums.include, albums);
  const albumExcludes = filters.albumNone
    ? []
    : albumNames(filters.albums.exclude, albums);

  const described = joinParts(
    [
      filters.query === "" ? null : `the search “${filters.query}”`,
      domainIncludes.length === 0
        ? null
        : `${domainIncludes.length === 1 ? "the domain" : "the domains"} ${joinValues(domainIncludes)}`,
      domainExcludes.length === 0
        ? null
        : `excluding ${domainExcludes.length === 1 ? "the domain" : "the domains"} ${joinValues(domainExcludes)}`,
      filters.albumNone ? "links not in any album" : null,
      albumIncludes.length === 0
        ? null
        : `${albumIncludes.length === 1 ? "the album" : "the albums"} ${joinValues(albumIncludes)}`,
      albumExcludes.length === 0
        ? null
        : `excluding ${albumExcludes.length === 1 ? "the album" : "the albums"} ${joinValues(albumExcludes)}`,
      filters.favorite ? "favorites only" : null,
    ].filter((part): part is string => part !== null),
  );

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        No links match your filters
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
        Nothing matched {described}. Try a different search term, domain, or album,
        or turn off the favorites filter.
      </p>
      <Link
        href={buildLinksHref(clearLinkFilters(filters), basePath)}
        className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        Clear filters
      </Link>
    </div>
  );
}
