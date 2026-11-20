import Link from "next/link";

import type { AlbumOption } from "@/db/albums";
import { albumHref, membershipPreview } from "@/lib/albums";

export interface AlbumMembershipLabelProps {
  /** Albums this link belongs to, as the server last reported them. */
  albumIds: readonly string[];
  /** The page's own albums: already scoped to its side of the lock. */
  albums: readonly AlbumOption[];
  /** `/` or `/locked` — the detail route the names point at. */
  basePath?: string;
}

/**
 * The "which albums is this link in?" line on a card.
 *
 * It is a pure mapping of the two lists the page already loaded, so it cannot widen
 * what the page is allowed to show: a locked album's name is never in `albums` on the
 * light page, and no query runs here. Up to three names are shown; the rest collapse
 * into `+N`, whose native tooltip still names them.
 */
export function AlbumMembershipLabel({
  albumIds,
  albums,
  basePath = "/",
}: AlbumMembershipLabelProps) {
  const { shown, hidden } = membershipPreview(albumIds, albums);

  if (shown.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
      <span className="text-slate-400 dark:text-slate-500">In </span>
      {shown.map((album, index) => (
        <span key={album.id} className="inline-flex items-center">
          {index === 0 ? null : <span className="sr-only">, </span>}
          <Link
            href={albumHref(album.id, basePath)}
            className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            {album.name}
          </Link>
        </span>
      ))}
      {hidden.length === 0 ? null : (
        <span
          className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          title={hidden.map((album) => album.name).join(", ")}
        >
          {/* One text child: React's streaming renderer would otherwise split
              `+{n}` into `+<!-- -->1`, which breaks both the text and its copy. */}
          {`+${hidden.length}`}
          <span className="sr-only"> more albums</span>
        </span>
      )}
    </p>
  );
}
