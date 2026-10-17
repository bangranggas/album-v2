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

export function LinkCard({ link }: { link: Link }) {
  const host = link.domain === "" ? hostOf(link.url) : link.domain;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100">
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
          <span className="px-4 text-center text-sm font-medium text-slate-400">
            {host}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h2
          className="line-clamp-2 text-sm font-semibold text-slate-900"
          title={link.title}
        >
          {link.title}
        </h2>

        <p className="mt-auto flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
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
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Open link
        </a>
      </div>
    </article>
  );
}
