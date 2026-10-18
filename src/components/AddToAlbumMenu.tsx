"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AlbumOption } from "@/db/albums";
import { callApi } from "@/lib/dashboard-api";
import { MAX_ALBUM_NAME_LENGTH } from "@/lib/validation";

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

const FIELD =
  "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

/**
 * The new album's id, read defensively out of the create response: the panel is a
 * client component, so the payload is `unknown` until it has been checked.
 */
function readAlbumId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;

  const album = (data as { album?: unknown }).album;
  if (typeof album !== "object" || album === null) return null;

  const id = (album as { id?: unknown }).id;

  return typeof id === "string" && id !== "" ? id : null;
}

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
 * The per-card "add to album" popup: a checkbox per album, plus "create an album
 * and put this link in it".
 *
 * It is a panel inside the card, not a dialog or a `window.prompt` — the project
 * keeps every interaction on the page. It closes on the `Done` button, on `Escape`,
 * and on a click outside.
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
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
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
    setNewName("");
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") close();
    }

    function onPointerDown(event: MouseEvent): void {
      if (container.current?.contains(event.target as Node) === true) return;
      close();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [close, open]);

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

  async function createAndAdd(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    // Two calls, in order: the album has to exist before the link can join it. The
    // create endpoint is the same tested one the Albums tab uses, and it answers
    // with the new album, so the id never has to be guessed from the name.
    const created = await callApi("/api/dashboard/albums", "POST", { name: newName });
    const albumId = created.ok ? readAlbumId(created.data) : null;

    if (albumId === null) {
      setBusy(false);
      if (created.ok) {
        setError(
          "The album was created, but the link could not be added. Add it from the album's page.",
        );
        router.refresh();
        return;
      }

      handleFailure(created.status, created.message);
      return;
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
      return;
    }

    setMemberIds((ids) => (ids.includes(albumId) ? ids : [...ids, albumId]));
    setNewName("");
    setCreating(false);
    router.refresh();
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
          <p className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Albums for this link
          </p>

          {albums.length === 0 ? (
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              No albums yet. Create the first one below.
            </p>
          ) : (
            <ul className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {albums.map((album) => (
                <li key={album.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={memberIds.includes(album.id)}
                      disabled={busy}
                      onChange={(event) => toggle(album.id, event.target.checked)}
                      className="h-3.5 w-3.5 accent-slate-900 dark:accent-slate-100"
                    />
                    <span className="truncate" title={album.name}>
                      {album.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createAndAdd();
              }}
              className="mb-2 flex flex-col gap-1.5"
            >
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                New album name
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  required
                  maxLength={MAX_ALBUM_NAME_LENGTH}
                  className={FIELD}
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  {busy ? "Creating…" : "Create and add"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setError(null);
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setCreating(true);
              }}
              className="mb-2 w-full rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              + New album…
            </button>
          )}

          {error === null ? null : (
            <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={close}
            className="w-full rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
