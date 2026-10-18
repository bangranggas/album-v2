"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { AlbumPickerPanel } from "@/components/AlbumPickerPanel";
import { useSelection } from "@/components/SelectionProvider";
import type { AlbumOption } from "@/db/albums";
import { albumScopeForPage } from "@/lib/albums";
import {
  callApi,
  readBulkAddCounts,
  readCreatedAlbumId,
} from "@/lib/dashboard-api";
import {
  bulkAddReport,
  partitionSelection,
  selectionLabel,
} from "@/lib/link-selection";

const BAR_BUTTON =
  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

export interface SelectionBarProps {
  /** Every album, in the Albums tab's order. */
  albums: readonly AlbumOption[];
  /** The ids the current page renders, so the bar can mark what is out of view. */
  visibleIds: readonly string[];
  /** True on the locked page, so an expired passcode sends the visitor back. */
  locked?: boolean;
}

/**
 * The floating bar for a bulk selection: how many links are selected, how much of
 * that the page is showing, "Add to album", and "Clear".
 *
 * It is fixed to the bottom of the viewport so a selection made at the end of a
 * hundred-card list can be acted on without scrolling back up, and it only exists
 * while something is selected. The album panel is the same component the card
 * popup uses, in its add-only mode.
 *
 * The selection is deliberately *not* cleared after a successful add: filing the
 * same links into a second album then needs no re-selection. The report is tied to
 * the selection that produced it, so changing the selection drops it.
 */
export function SelectionBar({
  albums,
  visibleIds,
  locked = false,
}: SelectionBarProps) {
  const router = useRouter();
  const selection = useSelection();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ key: string; text: string } | null>(
    null,
  );
  const container = useRef<HTMLDivElement>(null);

  const selectedIds = selection === null ? [] : selection.selectedIds;
  const selectionKey = selectedIds.join(",");
  const reportText = report?.key === selectionKey ? report.text : null;

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  if (selection === null || selectedIds.length === 0) return null;

  const { outOfView } = partitionSelection(selectedIds, visibleIds);

  /** Files the whole selection into one album; reports whether it worked. */
  async function fileInto(albumId: string, albumName: string): Promise<boolean> {
    setBusy(true);
    setError(null);

    const result = await callApi(`/api/dashboard/albums/${albumId}/links`, "POST", {
      linkIds: [...selectedIds],
    });

    setBusy(false);

    if (!result.ok) {
      if (result.status === 401 && locked) {
        router.push("/locked/unlock");
        return false;
      }

      setError(result.message);
      // The album went away in another tab: refresh so the panel lists what exists.
      if (result.status === 404) router.refresh();

      return false;
    }

    const counts = readBulkAddCounts(result.data);
    setReport({
      key: selectionKey,
      text:
        counts === null
          ? `Added to “${albumName}”.`
          : bulkAddReport(counts, albumName),
    });
    setOpen(false);
    router.refresh();

    return true;
  }

  async function pick(albumId: string): Promise<void> {
    if (busy) return;

    const album = albums.find((candidate) => candidate.id === albumId);
    if (album === undefined) return;

    await fileInto(album.id, album.name);
  }

  async function createAndFile(name: string): Promise<string | null> {
    if (busy) return null;

    setBusy(true);
    setError(null);

    // The album has to exist before the links can join it, and the create endpoint
    // answers with the new album, so its id never has to be guessed from the name.
    const created = await callApi("/api/dashboard/albums", "POST", {
      name,
      // The selection was made on this page, so the new album belongs to it.
      scope: albumScopeForPage(locked),
    });
    const albumId = created.ok ? readCreatedAlbumId(created.data) : null;

    if (albumId === null) {
      setBusy(false);

      if (created.ok) {
        const message =
          "The album was created, but the links could not be added. Open the album and add them there.";
        setError(message);
        router.refresh();

        return message;
      }

      setError(created.message);

      return created.message;
    }

    setBusy(false);
    await fileInto(albumId, name);

    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        ref={container}
        className="pointer-events-auto relative flex max-w-full flex-col gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
      >
        {!open ? null : (
          <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <AlbumPickerPanel
              mode="addOnly"
              albums={albums}
              selectionCount={selectedIds.length}
              onPick={(albumId) => {
                void pick(albumId);
              }}
              onCreate={createAndFile}
              onDone={close}
              onClearError={() => setError(null)}
              busy={busy}
              error={error}
              containerRef={container}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {selectionLabel(selectedIds.length, outOfView.length)}
          </p>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setOpen((value) => !value);
            }}
            aria-expanded={open}
            className={`${BAR_BUTTON} bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300`}
          >
            Add to album
          </button>

          <button
            type="button"
            onClick={() => {
              selection.clear();
            }}
            className={`${BAR_BUTTON} text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100`}
          >
            Clear
          </button>
        </div>

        {reportText === null ? null : (
          <p
            role="status"
            className="text-xs font-medium text-emerald-700 dark:text-emerald-400"
          >
            {reportText}
          </p>
        )}
      </div>
    </div>
  );
}
