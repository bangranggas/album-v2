"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { AlbumPickerPanel } from "@/components/AlbumPickerPanel";
import type { AlbumOption } from "@/db/albums";
import { albumScopeForPage } from "@/lib/albums";
import { callApi, readCreatedAlbumId } from "@/lib/dashboard-api";

function FolderPlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.75 6.75A1.75 1.75 0 015.5 5h3.6c.55 0 1.07.26 1.4.7l.9 1.2c.33.44.85.7 1.4.7h5.7a1.75 1.75 0 011.75 1.75v8.9A1.75 1.75 0 0118.5 20h-13a1.75 1.75 0 01-1.75-1.75V6.75z" />
      <path d="M12 12.5v4M10 14.5h4" />
    </svg>
  );
}

const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-slate-100";

export interface AddToAlbumMenuProps {
  linkId: string;
  /** Every album, in the Albums tab's order. */
  albums: readonly AlbumOption[];
  /** The albums this link is already in, as the server last reported them. */
  memberAlbumIds: readonly string[];
  /** True on the locked page, so an expired passcode sends the visitor back. */
  locked?: boolean;
}

/**
 * The per-card "add to album" popup: the shared album panel in its one-link mode.
 *
 * Checking is optimistic (the box flips at once) and the server is the final word:
 * every change ends in `router.refresh()`, so the props coming back replace the
 * local guess. A failure rolls the box back and says why.
 */
export function AddToAlbumMenu({
  linkId,
  albums,
  memberAlbumIds,
  locked = false,
}: AddToAlbumMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const [memberIds, setMemberIds] = useState<readonly string[]>(memberAlbumIds);
  const [seenMembers, setSeenMembers] = useState(memberAlbumIds.join(","));

  // Follow the server's list whenever it changes (a refresh, another tab) without
  // discarding an optimistic change that is still in flight. Adjusting state during
  // render is the sanctioned way to follow a changed prop — see `LinkFilters`.
  const membersKey = memberAlbumIds.join(",");
  if (membersKey !== seenMembers) {
    setSeenMembers(membersKey);
    setMemberIds(memberAlbumIds);
  }

  /** A passcode that expired mid-session sends the visitor back to the prompt. */
  function handleFailure(status: number, message: string): void {
    if (status === 401 && locked) {
      router.push("/locked/unlock");
      return;
    }

    setError(message);
  }

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function toggle(albumId: string, checked: boolean): Promise<void> {
    if (busy) return;

    const previous = memberIds;
    setBusy(true);
    setError(null);
    setMemberIds(
      checked ? [...memberIds, albumId] : memberIds.filter((id) => id !== albumId),
    );

    const result = checked
      ? await callApi(`/api/dashboard/links/${linkId}/albums`, "POST", { albumId })
      : await callApi(`/api/dashboard/links/${linkId}/albums/${albumId}`, "DELETE");

    setBusy(false);

    if (!result.ok) {
      setMemberIds(previous);
      handleFailure(result.status, result.message);

      // The album or the link went away in another tab: refresh so the panel shows
      // what actually exists instead of a checkbox for something that is gone.
      if (result.status === 404) router.refresh();

      return;
    }

    router.refresh();
  }

  async function createAndAdd(name: string): Promise<string | null> {
    if (busy) return null;

    setBusy(true);
    setError(null);

    // Two calls, in order: the album has to exist before the link can join it. The
    // create endpoint is the same tested one the Albums tab uses, and it answers
    // with the new album, so the id never has to be guessed from the name.
    const created = await callApi("/api/dashboard/albums", "POST", {
      name,
      // Filed on the side this popup was opened from; the album list it offers is
      // already that side's, so the new album lands where its siblings are.
      scope: albumScopeForPage(locked),
    });
    const albumId = created.ok ? readCreatedAlbumId(created.data) : null;

    if (albumId === null) {
      setBusy(false);

      if (created.ok) {
        const message =
          "The album was created, but the link could not be added. Add it from the album's page.";
        setError(message);
        router.refresh();

        return message;
      }

      handleFailure(created.status, created.message);

      return created.message;
    }

    const added = await callApi(`/api/dashboard/links/${linkId}/albums`, "POST", {
      albumId,
    });

    setBusy(false);

    if (!added.ok) {
      handleFailure(added.status, added.message);
      // The album exists now, so the refreshed page shows it; only the membership
      // has to be retried.
      router.refresh();

      return added.message;
    }

    setMemberIds((ids) => (ids.includes(albumId) ? ids : [...ids, albumId]));
    router.refresh();

    return null;
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-label="Add to album"
        title="Add to album"
        className={ICON_BUTTON}
      >
        <FolderPlusIcon />
      </button>

      {!open ? null : (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <AlbumPickerPanel
            mode="toggle"
            albums={albums}
            memberAlbumIds={memberIds}
            onToggle={(albumId, checked) => {
              void toggle(albumId, checked);
            }}
            onCreate={createAndAdd}
            onDone={close}
            onClearError={() => setError(null)}
            busy={busy}
            error={error}
            containerRef={container}
          />
        </div>
      )}
    </div>
  );
}
