/**
 * The dashboard's filter state, as read from and written to the query string.
 *
 * `""` always means "not filtering", so an absent parameter and an empty one
 * behave identically. `favorite` is the one boolean filter: it selects the
 * starred subset instead of the whole list.
 *
 * `album` asks whether a link has been filed into an album on this page's side:
 * `""` is "all", `"in"` keeps the filed links, and `"none"` keeps the loose ones.
 */
export type AlbumFilter = "" | "in" | "none";

export interface LinkFilters {
  query: string;
  domain: string;
  album: AlbumFilter;
  favorite: boolean;
}

/** Generous caps that comfortably fit any real title or search term. */
export const MAX_QUERY_LENGTH = 200;
export const MAX_DOMAIN_LENGTH = 253;

/**
 * The album search box holds a name, so it is capped at the longest name the
 * database would ever store (`MAX_ALBUM_NAME_LENGTH` mirrors this value).
 */
export const MAX_ALBUM_QUERY_LENGTH = 100;

/**
 * The two views of the same link list. The tab is part of the URL rather than of
 * component state, so a refresh, a bookmark and the back button all agree.
 */
export type DashboardTab = "links" | "albums";

/** Spellings that select the albums tab; anything else means the links tab. */
const ALBUM_TAB_VALUES = new Set(["albums", "album"]);

export type RawSearchParams = Record<
  string,
  string | string[] | undefined
>;

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

/**
 * Which tab the URL asks for. Unknown values fall back to the links tab instead
 * of erroring, so a hand-typed or stale link still lands somewhere useful.
 */
export function resolveTab(raw: RawSearchParams): DashboardTab {
  const value = firstValue(raw.tab).trim().toLowerCase();

  return ALBUM_TAB_VALUES.has(value) ? "albums" : "links";
}

/**
 * The album search box's own parameter. It deliberately does not read `q`: each
 * tab keeps its filters to itself, so switching tabs never silently carries a
 * search across.
 */
export function resolveAlbumQuery(raw: RawSearchParams): string {
  return firstValue(raw.aq).trim().slice(0, MAX_ALBUM_QUERY_LENGTH);
}

/** Values that switch a boolean filter on; everything else means off. */
const AFFIRMATIVE = new Set(["1", "true", "on", "yes"]);

/**
 * Which album membership the URL asks for. Unknown values fall back to "all"
 * instead of erroring, matching how every other filter treats bad input.
 */
export function resolveAlbumFilter(raw: RawSearchParams): AlbumFilter {
  const value = firstValue(raw.album).trim().toLowerCase();

  return value === "in" || value === "none" ? value : "";
}

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
    album: resolveAlbumFilter(raw),
    favorite: AFFIRMATIVE.has(firstValue(raw.favorite).trim().toLowerCase()),
  };
}

export function hasActiveFilters(filters: LinkFilters): boolean {
  return (
    filters.query !== "" ||
    filters.domain !== "" ||
    filters.album !== "" ||
    filters.favorite
  );
}

/**
 * Builds the dashboard URL for a set of filters. This is the single place that
 * decides the parameter names and their order, shared by the client component and
 * any server-rendered link.
 */
export function buildLinksHref(filters: LinkFilters, basePath = "/"): string {
  const params = new URLSearchParams();

  if (filters.domain !== "") params.set("domain", filters.domain);
  if (filters.album !== "") params.set("album", filters.album);
  if (filters.query !== "") params.set("q", filters.query);
  if (filters.favorite) params.set("favorite", "1");

  const search = params.toString();

  return search === "" ? basePath : `${basePath}?${search}`;
}

/**
 * The count line above a grid: `"5 links"` when nothing is filtered, and
 * `"3 of 5 links"` when a filter is narrowing the list. `noun` is singular; the
 * plural is formed by adding `s`.
 */
export function formatCount(
  shown: number,
  total: number,
  filtering: boolean,
  noun: string,
): string {
  const label = total === 1 ? noun : `${noun}s`;

  return filtering ? `${shown} of ${total} ${label}` : `${shown} ${label}`;
}

export function formatLinkCount(
  shown: number,
  total: number,
  filtering: boolean,
): string {
  return formatCount(shown, total, filtering, "link");
}

/**
 * The URL that switches tabs. Switching deliberately drops every filter: the two
 * tabs have separate parameters, and carrying `?q=` onto the albums tab (or `?aq=`
 * back) would look like a filter that silently does nothing.
 */
export function buildTabHref(tab: DashboardTab, basePath = "/"): string {
  return tab === "albums" ? `${basePath}?tab=albums` : basePath;
}

/** The albums tab URL with its own search box value. Order: tab, then `aq`. */
export function buildAlbumsHref(query: string, basePath = "/"): string {
  const params = new URLSearchParams();
  params.set("tab", "albums");
  if (query !== "") params.set("aq", query);

  return `${basePath}?${params.toString()}`;
}

