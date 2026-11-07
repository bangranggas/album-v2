import {
  EMPTY_CATEGORY,
  hasCategorySelection,
  type CategorySelection,
} from "./filter-selection";

/**
 * The dashboard's filter state, as read from and written to the query string.
 *
 * Domain and Album are multi-value categories, each with an include and an exclude
 * list. A value can never appear in both lists; `resolveLinkFilters` enforces that
 * even for hand-typed URLs. `albumNone` is the Album category's special option:
 * "Not in an album", which is exclusive with any concrete album selection.
 *
 * `view` is a display preference rather than a filter: it never makes the "Clear
 * filters" button appear and is preserved when the filters are cleared.
 */

export type LinkView = "grid" | "list";

export interface LinkFilters {
  query: string;
  domains: CategorySelection;
  albums: CategorySelection;
  /** True for the Album category's "Not in an album" option. */
  albumNone: boolean;
  favorite: boolean;
  view: LinkView;
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
 * A URL can carry many values per category. The cap keeps a hand-edited or
 * malicious link from turning into an unbounded `IN (…)` list.
 */
export const MAX_FILTER_VALUES = 50;

/** Album ids are UUIDs; this is generous enough for any future id format. */
export const MAX_ALBUM_ID_LENGTH = 100;

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

export const EMPTY_FILTERS: LinkFilters = {
  query: "",
  domains: EMPTY_CATEGORY,
  albums: EMPTY_CATEGORY,
  albumNone: false,
  favorite: false,
  view: "grid",
};

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function allValues(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
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

function normaliseDomain(value: string): string {
  return value.trim().toLowerCase().slice(0, MAX_DOMAIN_LENGTH);
}

function normaliseAlbumId(value: string): string {
  return value.trim().slice(0, MAX_ALBUM_ID_LENGTH);
}

/** `in` and `none` are the old single-value album choices, not album ids. */
function isLegacyAlbumToken(value: string): boolean {
  const token = value.trim().toLowerCase();

  return token === "in" || token === "none";
}

function uniqueValues(
  values: readonly string[],
  normalise: (value: string) => string,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of values) {
    const value = normalise(entry);

    if (value === "" || seen.has(value)) continue;

    seen.add(value);
    result.push(value);

    if (result.length === MAX_FILTER_VALUES) break;
  }

  return result;
}

/**
 * Reads one category's two lists. A value that appears in both is kept only in
 * include: the include list is the narrower, more explicit intent, and the UI can
 * never produce the conflict in the first place.
 */
function readSelection(
  raw: RawSearchParams,
  includeKey: string,
  excludeKey: string,
  normalise: (value: string) => string,
): CategorySelection {
  const include = uniqueValues(allValues(raw[includeKey]), normalise);
  const excluded = new Set(include);
  const exclude = uniqueValues(allValues(raw[excludeKey]), normalise).filter(
    (value) => !excluded.has(value),
  );

  return { include, exclude };
}

/**
 * Which view the URL asks for. Anything other than the explicit `list` spelling
 * falls back to the grid, matching how every other filter treats bad input.
 */
export function resolveView(raw: RawSearchParams): LinkView {
  return firstValue(raw.view).trim().toLowerCase() === "list" ? "list" : "grid";
}

/**
 * Normalises raw `searchParams` into filters the repository can use directly.
 *
 * The domain is lowercased because that is how it is stored; the query is left
 * as typed, because matching is case-insensitive on the database side. Over-long
 * values are truncated rather than dropped, so a paste cannot silently disable
 * the filter.
 *
 * Legacy links are honoured: a single `?domain=` is an include, `?album=none`
 * becomes `albumNone`, and `?album=in` simply applies no album filter (the new UI
 * has no "in any album" choice, and treating it as "nothing" is the safe reading).
 */
export function resolveLinkFilters(raw: RawSearchParams): LinkFilters {
  const albumValues = allValues(raw.album);
  const legacyNone = albumValues.some(
    (value) => value.trim().toLowerCase() === "none",
  );
  const albumNone =
    legacyNone || AFFIRMATIVE.has(firstValue(raw.albumNone).trim().toLowerCase());

  const albums = albumNone
    ? { include: [], exclude: [] }
    : readSelection(
        {
          ...raw,
          album: albumValues.filter((value) => !isLegacyAlbumToken(value)),
        },
        "album",
        "albumExclude",
        normaliseAlbumId,
      );

  return {
    query: firstValue(raw.q).trim().slice(0, MAX_QUERY_LENGTH),
    domains: readSelection(
      raw,
      "domain",
      "domainExclude",
      normaliseDomain,
    ),
    albums,
    albumNone,
    favorite: AFFIRMATIVE.has(firstValue(raw.favorite).trim().toLowerCase()),
    view: resolveView(raw),
  };
}

export function hasActiveFilters(filters: LinkFilters): boolean {
  return (
    filters.query !== "" ||
    hasCategorySelection(filters.domains) ||
    filters.albumNone ||
    hasCategorySelection(filters.albums) ||
    filters.favorite
  );
}

/** The same filters with every category cleared, keeping only the view. */
export function clearLinkFilters(filters: LinkFilters): LinkFilters {
  return { ...EMPTY_FILTERS, view: filters.view };
}

/**
 * The filters for an album's own page: every link there is already inside that
 * album, so the Album category has nothing meaningful to say and a shared
 * `?album=` URL must not change the page's count line.
 */
export function withoutAlbumFilter(filters: LinkFilters): LinkFilters {
  return { ...filters, albums: EMPTY_CATEGORY, albumNone: false };
}

/**
 * Builds the dashboard URL for a set of filters. This is the single place that
 * decides the parameter names and their order, shared by the client component and
 * any server-rendered link.
 */
export function buildLinksHref(filters: LinkFilters, basePath = "/"): string {
  const params = new URLSearchParams();

  for (const value of filters.domains.include) params.append("domain", value);
  for (const value of filters.domains.exclude) {
    params.append("domainExclude", value);
  }

  if (filters.albumNone) {
    params.set("albumNone", "1");
  } else {
    for (const value of filters.albums.include) params.append("album", value);
    for (const value of filters.albums.exclude) {
      params.append("albumExclude", value);
    }
  }

  if (filters.query !== "") params.set("q", filters.query);
  if (filters.favorite) params.set("favorite", "1");
  if (filters.view === "list") params.set("view", "list");

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
