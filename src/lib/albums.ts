import { formatCount } from "./link-filters";

/**
 * How many thumbnails an album's cover collage shows: a 2×2 grid.
 *
 * This is also the number of thumbnails the repository reads per album, so the
 * grid and the query can never disagree about how big a collage is.
 */
export const COLLAGE_SLOTS = 4;

/**
 * The two sides an album can live on: the light dashboard (`visible`) or the
 * passcode-gated area (`locked`). It is the link rule's vocabulary minus its `all`
 * escape hatch — an album always belongs to exactly one visitor-facing side, and
 * nothing an album shows uses `all`.
 */
export type AlbumScope = "visible" | "locked";

/** The sides, for the payload parser and for tests that walk both. */
export const ALBUM_SCOPES: readonly AlbumScope[] = ["visible", "locked"];

export function isAlbumScope(value: unknown): value is AlbumScope {
  return value === "visible" || value === "locked";
}

/**
 * The side an album started on, derived from the page it was created from.
 *
 * Every page already knows whether it is the locked one (it passes `locked` down to
 * its cards and forms), so the side never has to be threaded as a second flag that
 * could disagree with the theme and the gate around it.
 */
export function albumScopeForPage(locked: boolean): AlbumScope {
  return locked ? "locked" : "visible";
}

/** The count line above the album grid: `"5 albums"` / `"2 of 5 albums"`. */
export function formatAlbumCount(
  shown: number,
  total: number,
  filtering: boolean,
): string {
  return formatCount(shown, total, filtering, "album");
}

/**
 * The collage as a fixed-size list of slots: the thumbnails in order, then `null`
 * for each place the album has no image for.
 *
 * Padding here (rather than in the component) is what lets the grid always draw
 * the same four cells, so a one-image album and a four-image album line up.
 */
export function collageSlots(covers: readonly string[]): (string | null)[] {
  return Array.from(
    { length: COLLAGE_SLOTS },
    (_unused, index) => covers[index] ?? null,
  );
}

/**
 * Where an album lives. The light dashboard and the hidden area each have their
 * own detail route (`/albums/[id]` vs `/locked/albums/[id]`), so a light page can
 * never link to a dark one by accident.
 */
export function albumHref(albumId: string, basePath = "/"): string {
  const segment = encodeURIComponent(albumId);

  return basePath === "/" ? `/albums/${segment}` : `${basePath}/albums/${segment}`;
}
