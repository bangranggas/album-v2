import { LinkActions } from "@/components/LinkActions";
import type { AlbumOption } from "@/db/albums";
import type { Link } from "@/db/schema";
import { formatRelativeTime } from "@/lib/time";

/** Fallback for a legacy row whose domain could not be derived at write time. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface LinkCardProps {
  link: Link;
  /** True on the locked page; passed down so an expired passcode redirects. */
  locked?: boolean;
  /** Every album, for the "add to album" popup. */
  albums?: readonly AlbumOption[];
  /** Albums this link belongs to, as the server last reported. */
  memberAlbumIds?: readonly string[];
  /** Set on an album's page, where "remove from this album" makes sense. */
  removeFromAlbumId?: string;
}

export function LinkCard({
  link,
  locked = false,
  albums,
  memberAlbumIds,
  removeFromAlbumId,
}: LinkCardProps) {
  const host = link.domain === "" ? hostOf(link.url) : link.domain;

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {/*
        The rounding and the clipping live on the cover, not on the card, so the
        "add to album" popup can overflow the card instead of being cut off.
      */}
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800">
        {link.thumbnail ? (
          // Plain <img> on purpose: thumbnails come from arbitrary third-party
          // hosts, and next/image would add remote-pattern config plus Vercel
          // image-optimization usage. The project targets zero infrastructure cost.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="px-4 text-center text-sm font-medium text-slate-400 dark:text-slate-500">
            {host}
          </span>
        )}

        {link.isFavorite ? (
          <span
            title="Favorite"
            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-amber-500 shadow-sm dark:bg-slate-950/90 dark:text-amber-400"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="currentColor"
            >
              <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5z" />
            </svg>
            <span className="sr-only">Favorite</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h2
          className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100"
          title={link.title}
        >
          {link.title}
        </h2>

        <p className="mt-auto flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate" title={link.url}>
            {host}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(link.updatedAt).toISOString()}>
            {formatRelativeTime(link.updatedAt)}
          </time>
        </p>

        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 dark:focus-visible:outline-slate-100"
        >
          Open link
        </a>

        <LinkActions
          link={link}
          locked={locked}
          albums={albums}
          memberAlbumIds={memberAlbumIds}
          removeFromAlbumId={removeFromAlbumId}
        />
      </div>
    </article>
  );
}
