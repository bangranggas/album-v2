/**
 * The dashboard's filter state, as read from and written to the query string.
 *
 * `""` always means "not filtering", so an absent parameter and an empty one
 * behave identically. `favorite` is the one boolean filter: it selects the
 * starred subset instead of the whole list.
 */
export interface LinkFilters {
  query: string;
  domain: string;
  favorite: boolean;
}

/** Generous caps that comfortably fit any real title or search term. */
export const MAX_QUERY_LENGTH = 200;
export const MAX_DOMAIN_LENGTH = 253;

export type RawSearchParams = Record<
  string,
  string | string[] | undefined
>;

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

/** Values that switch a boolean filter on; everything else means off. */
const AFFIRMATIVE = new Set(["1", "true", "on", "yes"]);

/**
 * Normalises raw `searchParams` into filters the repository can use directly.
 *
 * The domain is lowercased because that is how it is stored; the query is left
 * as typed, because matching is case-insensitive on the database side. Over-long
 * values are truncated rather than dropped, so a paste cannot silently disable
 * the filter.
 */
export function resolveLinkFilters(raw: RawSearchParams): LinkFilters {
  return {
    query: firstValue(raw.q).trim().slice(0, MAX_QUERY_LENGTH),
    domain: firstValue(raw.domain)
      .trim()
      .toLowerCase()
      .slice(0, MAX_DOMAIN_LENGTH),
    favorite: AFFIRMATIVE.has(firstValue(raw.favorite).trim().toLowerCase()),
  };
}

export function hasActiveFilters(filters: LinkFilters): boolean {
  return filters.query !== "" || filters.domain !== "" || filters.favorite;
}

/**
 * Builds the dashboard URL for a set of filters. This is the single place that
 * decides the parameter names and their order, shared by the client component and
 * any server-rendered link.
 */
export function buildLinksHref(filters: LinkFilters, basePath = "/"): string {
  const params = new URLSearchParams();

  if (filters.domain !== "") params.set("domain", filters.domain);
  if (filters.query !== "") params.set("q", filters.query);
  if (filters.favorite) params.set("favorite", "1");

  const search = params.toString();

  return search === "" ? basePath : `${basePath}?${search}`;
}

/**
 * The count line above the grid: `"5 links"` when nothing is filtered, and
 * `"3 of 5 links"` when a filter is narrowing the list.
 */
export function formatLinkCount(
  shown: number,
  total: number,
  filtering: boolean,
): string {
  const noun = total === 1 ? "link" : "links";

  return filtering ? `${shown} of ${total} ${noun}` : `${shown} ${noun}`;
}
