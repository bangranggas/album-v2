import Link from "next/link";

import { AlbumActions } from "@/components/AlbumActions";
import { AlbumCover } from "@/components/AlbumCover";
import type { AlbumSummary } from "@/db/albums";
import { albumHref } from "@/lib/albums";
import { formatLinkCount } from "@/lib/link-filters";

export interface AlbumCardProps {
  album: AlbumSummary;
  /** `/` on the light dashboard, `/locked` in the hidden area. */
  basePath?: string;
  locked?: boolean;
}

/**
 * One album tile: cover, name, count on this side of the divide, and the inline
 * rename/delete controls.
 *
 * The count is rendered even when it is `0`: "empty" is a legitimate state (an
 * album can be created before anything is filed into it), and a tile that says
 * nothing would look like a failed load.
 */
export function AlbumCard({ album, basePath = "/", locked = false }: AlbumCardProps) {
  const href = albumHref(album.id, basePath);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <Link href={href} className="block" aria-label={`Open ${album.name}`}>
        <AlbumCover
          covers={album.covers}
          name={album.name}
          firstDomain={album.firstDomain}
        />
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Link href={href} className="line-clamp-2 hover:underline" title={album.name}>
              {album.name}
            </Link>
          </h2>

          <AlbumActions albumId={album.id} name={album.name} locked={locked} />
        </div>

        <p className="mt-auto text-xs text-slate-500 dark:text-slate-400">
          {formatLinkCount(album.linkCount, album.linkCount, false)}
        </p>
      </div>
    </article>
  );
}
