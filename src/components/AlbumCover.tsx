import { collageSlots } from "@/lib/albums";

/**
 * Grid placement per number of thumbnails, so every album tile is the same size
 * and a lone image fills it:
 *
 * - 1: the whole tile.
 * - 2: two columns, full height.
 * - 3: one tall image, two stacked beside it.
 * - 4: the 2×2 grid.
 */
const SPANS: Record<number, readonly string[]> = {
  1: ["col-span-2 row-span-2"],
  2: ["row-span-2", "row-span-2"],
  3: ["row-span-2", "", ""],
  4: ["", "", "", ""],
};

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-8 w-8 text-slate-400 dark:text-slate-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.75 6.75A1.75 1.75 0 015.5 5h3.6c.55 0 1.07.26 1.4.7l.9 1.2c.33.44.85.7 1.4.7h5.7a1.75 1.75 0 011.75 1.75v8.9A1.75 1.75 0 0118.5 20h-13a1.75 1.75 0 01-1.75-1.75V6.75z" />
    </svg>
  );
}

export interface AlbumCoverProps {
  covers: readonly string[];
  /** The album's name, used in the images' alternative text. */
  name: string;
  /** Shown in the grey placeholder; `null` means the album has no links here. */
  firstDomain: string | null;
}

/**
 * The folder-like cover: up to four thumbnails in a 2×2 grid, one image filling
 * the tile, and a grey placeholder with the album's first domain when nothing has
 * a thumbnail yet (a folder glyph when the album is empty).
 *
 * Plain `<img>` tags, like `LinkCard`: thumbnails come from arbitrary third-party
 * hosts, and `next/image` would add remote-pattern config and image-optimisation
 * usage to a project that targets zero infrastructure cost.
 */
export function AlbumCover({ covers, name, firstDomain }: AlbumCoverProps) {
  const slots = collageSlots(covers);
  const thumbnails = slots.filter((slot): slot is string => slot !== null);

  if (thumbnails.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center bg-slate-100 p-4 text-center dark:bg-slate-800">
        {firstDomain === null ? (
          <>
            <FolderIcon />
            <span className="sr-only">Empty album</span>
          </>
        ) : (
          <span className="truncate text-sm font-medium text-slate-400 dark:text-slate-500">
            {firstDomain}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="grid aspect-video grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden bg-slate-200 dark:bg-slate-800">
      {thumbnails.map((thumbnail, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${index}:${thumbnail}`}
          src={thumbnail}
          alt={`Cover of ${name}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`h-full w-full object-cover ${SPANS[thumbnails.length]?.[index] ?? ""}`}
        />
      ))}
    </div>
  );
}
