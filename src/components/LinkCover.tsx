"use client";

import { useSelection } from "@/components/SelectionProvider";

export interface LinkCoverProps {
  /** The link this cover belongs to: the checkbox's value. */
  linkId: string;
  /** The link's title, for the checkbox's accessible name. */
  title: string;
  /** The thumbnail URL, or `null` when the link has none. */
  thumbnail: string | null;
  /** The domain shown in place of a missing thumbnail. */
  host: string;
}

/**
 * The card's cover: the thumbnail (or the domain when there is none) plus, on a page
 * with bulk selection, the checkbox that selects the link.
 *
 * The checkbox comes first in the markup so the whole cover can be its `<label>` —
 * clicking the image is then a much larger target for the same control, and the
 * browser keeps them in sync with no extra state. Without a `SelectionProvider` (an
 * album's page) there is nothing to select, so the cover renders exactly as before,
 * with no control at all.
 */
export function LinkCover({ linkId, title, thumbnail, host }: LinkCoverProps) {
  const selection = useSelection();

  const image =
    thumbnail === null ? (
      <span className="px-4 text-center text-sm font-medium text-slate-400 dark:text-slate-500">
        {host}
      </span>
    ) : (
      // Plain <img> on purpose: thumbnails come from arbitrary third-party hosts, and
      // next/image would add remote-pattern config plus Vercel image-optimization
      // usage. The project targets zero infrastructure cost.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnail}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
    );

  if (selection === null) return image;

  return (
    <label className="absolute inset-0 flex cursor-pointer items-center justify-center">
      <span className="absolute left-2 top-2 z-10 rounded bg-white/90 p-0.5 shadow-sm dark:bg-slate-950/90">
        <input
          type="checkbox"
          checked={selection.isSelected(linkId)}
          onChange={() => selection.toggle(linkId)}
          aria-label={`Select ${title}`}
          className="block h-4 w-4 cursor-pointer rounded accent-slate-900 dark:accent-slate-100"
        />
      </span>
      {image}
    </label>
  );
}
