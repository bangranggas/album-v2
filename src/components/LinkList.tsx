"use client";

import type { KeyboardEvent, MouseEvent } from "react";

import { AlbumMembershipLabel } from "@/components/AlbumMembershipLabel";
import { LinkActions } from "@/components/LinkActions";
import { useSelection } from "@/components/SelectionProvider";
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

/**
 * True when the click landed on a control inside the row (action buttons, the
 * selection checkbox) rather than on the row itself, so those clicks must not
 * open the link behind them.
 */
function hitInteractive(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;

  return target?.closest("button, a, input, label") !== null;
}

function openUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface LinkListProps {
  links: readonly Link[];
  /** True on the locked page; passed down so an expired passcode redirects. */
  locked?: boolean;
  /** Every album, for the "add to album" popup. */
  albums?: readonly AlbumOption[];
  /** Albums per link id, as the server last reported them. */
  memberships?: ReadonlyMap<string, readonly string[]>;
  /** Set on an album's page, where "remove from this album" makes sense. */
  removeFromAlbumId?: string;
  /** `/` or `/locked`: where the row's album links point. */
  basePath?: string;
}

/**
 * The detailed table view of the same links.
 *
 * A row has no thumbnail: the title links to the link, and clicking anywhere on
 * the row opens it in a new tab. The rightmost column holds the same per-link
 * actions as a card (favorite, add to album, thumbnail, edit, delete), and on a
 * selectable page a checkbox leads each row.
 */
export function LinkList({
  links,
  locked = false,
  albums,
  memberships,
  removeFromAlbumId,
  basePath = "/",
}: LinkListProps) {
  const selection = useSelection();

  const cell = "py-3 align-middle text-xs text-slate-600 dark:text-slate-400";
  const hiddenCell = `${cell} hidden md:table-cell`;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {selection === null ? null : (
              <th scope="col" className="w-10 py-2 pl-3" aria-label="Select" />
            )}
            <th scope="col" className="py-2 pl-4 pr-3">
              Title
            </th>
            <th scope="col" className="w-36 py-2 pr-4 hidden md:table-cell">
              Domain
            </th>
            <th scope="col" className="w-44 py-2 pr-4 hidden md:table-cell">
              Albums
            </th>
            <th scope="col" className="w-20 py-2 pr-4 hidden md:table-cell">
              Updated
            </th>
            <th scope="col" className="w-48 py-2 pr-3 text-right md:w-56">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const host = link.domain === "" ? hostOf(link.url) : link.domain;
            const memberAlbumIds = memberships?.get(link.id) ?? [];

            return (
              <tr
                key={link.id}
                tabIndex={0}
                onClick={(event) => {
                  if (!hitInteractive(event)) openUrl(link.url);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.target === event.currentTarget) {
                    openUrl(link.url);
                  }
                }}
                title={`Open ${link.title}`}
                className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:border-slate-800 dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60"
              >
                {selection === null ? null : (
                  <td className="py-3 pl-3 align-middle">
                    <input
                      type="checkbox"
                      checked={selection.isSelected(link.id)}
                      onChange={() => selection.toggle(link.id)}
                      aria-label={`Select ${link.title}`}
                      className="h-4 w-4 cursor-pointer accent-slate-900 dark:accent-slate-100"
                    />
                  </td>
                )}

                <td className="py-2.5 pl-4 pr-3 align-middle md:py-3">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block line-clamp-2 text-sm font-semibold text-slate-900 underline-offset-2 transition hover:underline dark:text-slate-100"
                  >
                    {link.title}
                  </a>

                  {/*
                    On phones the Domain/Albums/Updated columns are hidden, so the
                    same information folds under the title instead of asking the
                    reader to scroll horizontally.
                  */}
                  <div className="mt-1.5 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400 md:hidden">
                    <span className="truncate" title={host}>
                      {host}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2">
                      <time
                        dateTime={new Date(link.updatedAt).toISOString()}
                        className="whitespace-nowrap"
                      >
                        {formatRelativeTime(link.updatedAt)}
                      </time>
                      {albums === undefined || memberAlbumIds.length === 0 ? null : (
                        <AlbumMembershipLabel
                          albumIds={memberAlbumIds}
                          albums={albums}
                          basePath={basePath}
                        />
                      )}
                    </span>
                  </div>
                </td>

                <td className={`${hiddenCell} px-4`}>
                  <span className="block truncate" title={host}>
                    {host}
                  </span>
                </td>

                <td className={`${hiddenCell} pr-4`}>
                  {albums === undefined ? (
                    <span className="text-slate-400 dark:text-slate-500">—</span>
                  ) : (
                    <AlbumMembershipLabel
                      albumIds={memberAlbumIds}
                      albums={albums}
                      basePath={basePath}
                    />
                  )}
                </td>

                <td className={`${hiddenCell} pr-4`}>
                  <time dateTime={new Date(link.updatedAt).toISOString()}>
                    {formatRelativeTime(link.updatedAt)}
                  </time>
                </td>

                <td className="py-2 pr-3 align-middle text-right md:py-3">
                  <div className="inline-flex justify-end">
                    <LinkActions
                      link={link}
                      locked={locked}
                      albums={albums}
                      memberAlbumIds={memberAlbumIds}
                      removeFromAlbumId={removeFromAlbumId}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}