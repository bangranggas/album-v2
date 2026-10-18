"use client";

import {
  useEffect,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type { AlbumOption } from "@/db/albums";
import { MAX_ALBUM_NAME_LENGTH } from "@/lib/validation";

const FIELD =
  "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

const ROW =
  "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800";

/** `toggle` files one link; `addOnly` files the whole selection. */
export type AlbumPickerMode = "toggle" | "addOnly";

export interface AlbumPickerPanelProps {
  mode: AlbumPickerMode;
  /** Every album, in the Albums tab's order. */
  albums: readonly AlbumOption[];
  /** `toggle`: the albums the link is already in, as the server last reported. */
  memberAlbumIds?: readonly string[];
  /** `addOnly`: how many links one click files, for the header. */
  selectionCount?: number;
  /** `toggle`: called with the album's new checkbox state. */
  onToggle?: (albumId: string, checked: boolean) => void;
  /** `addOnly`: called when an album row is clicked. */
  onPick?: (albumId: string) => void;
  /**
   * Creates an album and files the link(s) into it, in whatever order the caller
   * needs. Resolves to an error message to show, or `null` when it worked.
   */
  onCreate: (name: string) => Promise<string | null>;
  onDone: () => void;
  /** Drops the caller's error when the visitor starts a fresh interaction. */
  onClearError: () => void;
  busy: boolean;
  error: string | null;
  /**
   * The element holding both the trigger and this panel. A click or a press of
   * `Escape` outside it closes the panel; the trigger itself is inside, so the
   * button that opened the panel is not also the click that closes it.
   */
  containerRef: RefObject<HTMLDivElement | null>;
}

function pluralLinks(count: number): string {
  return count === 1 ? "1 link" : `${count} links`;
}

/**
 * The album list that both "add to album" flows share: a checkbox per album for
 * one link, a button per album for a whole selection, plus the inline
 * "create an album" form.
 *
 * It only draws the panel's contents — the caller owns the positioning (a card's
 * popup, or the bar above the selection bar) and the requests. It is a panel, not
 * a dialog or a `window.prompt`: the project keeps every interaction on the page.
 */
export function AlbumPickerPanel({
  mode,
  albums,
  memberAlbumIds = [],
  selectionCount = 0,
  onToggle,
  onPick,
  onCreate,
  onDone,
  onClearError,
  busy,
  error,
  containerRef,
}: AlbumPickerPanelProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onDone();
    }

    function onPointerDown(event: MouseEvent): void {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      onDone();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [containerRef, onDone]);

  async function submitCreate(event: FormEvent): Promise<void> {
    event.preventDefault();

    // The caller owns `busy` and `error`, so a failure leaves the typed name in
    // place to be retried; only a success resets the form.
    const message = await onCreate(newName);
    if (message !== null) return;

    setNewName("");
    setCreating(false);
  }

  return (
    <>
      <p className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {mode === "toggle"
          ? "Albums for this link"
          : `Add ${pluralLinks(selectionCount)} to…`}
      </p>

      {albums.length === 0 ? (
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          No albums yet. Create the first one below.
        </p>
      ) : (
        <ul className="mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {albums.map((album) => (
            <li key={album.id}>
              {mode === "toggle" ? (
                <label className={`${ROW} cursor-pointer`}>
                  <input
                    type="checkbox"
                    checked={memberAlbumIds.includes(album.id)}
                    disabled={busy}
                    onChange={(event) => onToggle?.(album.id, event.target.checked)}
                    className="h-3.5 w-3.5 accent-slate-900 dark:accent-slate-100"
                  />
                  <span className="truncate" title={album.name}>
                    {album.name}
                  </span>
                </label>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick?.(album.id)}
                  className={`${ROW} justify-between text-left`}
                >
                  <span className="truncate" title={album.name}>
                    {album.name}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">
                    +
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <form
          onSubmit={(event) => {
            void submitCreate(event);
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
                onClearError();
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
            onClearError();
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
        onClick={onDone}
        className="w-full rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
      >
        Done
      </button>
    </>
  );
}
