import Link from "next/link";

import { AlbumCard } from "@/components/AlbumCard";
import type { AlbumSummary } from "@/db/albums";
import { buildAlbumsHref } from "@/lib/link-filters";

export interface AlbumGridProps {
  albums: readonly AlbumSummary[];
  /** `/` on the light dashboard, `/locked` in the hidden area. */
  basePath?: string;
  locked?: boolean;
  /** The album search currently in the URL, so "nothing matched" can name it. */
  query?: string;
}

/**
 * The album list and its two empty states, shared by both pages so the light and
 * dark views cannot drift apart.
 *
 * "No albums yet" and "nothing matched your search" are different situations and
 * say so: only the second offers a way to clear the search.
 */
export function AlbumGrid({
  albums,
  basePath = "/",
  locked = false,
  query = "",
}: AlbumGridProps) {
  if (albums.length === 0) {
    return query === "" ? (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          No albums yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Create one with the button above, then add links to it from any card on
          the Links tab.
        </p>
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          No album matches “{query}”
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Try a shorter search, or clear it to see every album.
        </p>
        <Link
          href={buildAlbumsHref("", basePath)}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Clear search
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {albums.map((album) => (
        <li key={album.id}>
          <AlbumCard album={album} basePath={basePath} locked={locked} />
        </li>
      ))}
    </ul>
  );
}
