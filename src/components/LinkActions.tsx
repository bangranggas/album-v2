"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AddToAlbumMenu } from "@/components/AddToAlbumMenu";
import type { AlbumOption } from "@/db/albums";
import type { Link } from "@/db/schema";
import { callApi } from "@/lib/dashboard-api";
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH } from "@/lib/validation";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    >
      <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5z" />
    </svg>
  );
}

function PencilIcon() {
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
      <path d="M16.86 4.49l1.69-1.69a1.875 1.875 0 112.65 2.65L10.58 16.07a4.5 4.5 0 01-1.9 1.13L6 18l.8-2.69a4.5 4.5 0 011.13-1.9l8.93-8.92z" />
      <path d="M15 21H4.5A1.5 1.5 0 013 19.5V9" />
    </svg>
  );
}

function TrashIcon() {
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
      <path d="M4.75 5.75h14.5M9.5 5.75V4.5A1 1 0 0110.5 3.5h3a1 1 0 011 1v1.25M6 5.75l.9 13a2 2 0 002 1.85h6.2a2 2 0 002-1.85l.9-13" />
      <path d="M10.5 10v6M13.5 10v6" />
    </svg>
  );
}

const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:outline-slate-100";

const FIELD =
  "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

/**
 * The per-card controls: star, add-to-album, edit, delete.
 *
 * Edit is an inline form rather than a dialog, and delete is a two-step confirm
 * inside the card — the project deliberately avoids browser popups (the login
 * flow has no Basic Auth challenge for the same reason).
 */
export interface LinkActionsProps {
  link: Link;
  locked?: boolean;
  /** Every album, for the "add to album" popup. Omitted where it is not offered. */
  albums?: readonly AlbumOption[];
  /** The albums this link is already in, as the server last reported them. */
  memberAlbumIds?: readonly string[];
  /** Set on an album's page, where "remove from this album" makes sense. */
  removeFromAlbumId?: string;
}

export function LinkActions({
  link,
  locked = false,
  albums,
  memberAlbumIds,
  removeFromAlbumId,
}: LinkActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "editing" | "confirming">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(link.title);
  const [url, setUrl] = useState(link.url);
  const [thumbnail, setThumbnail] = useState(link.thumbnail ?? "");

  /** A passcode that expired mid-session sends the visitor back to the prompt. */
  function handleFailure(status: number, message: string): void {
    if (status === 401 && locked) {
      router.push("/locked/unlock");
      return;
    }

    setError(message);
  }

  async function toggleFavorite(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await callApi(`/api/dashboard/links/${link.id}`, "PATCH", {
      isFavorite: !link.isFavorite,
    });

    setBusy(false);

    if (!result.ok) {
      handleFailure(result.status, result.message);
      return;
    }

    router.refresh();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await callApi(`/api/dashboard/links/${link.id}`, "PATCH", {
      title,
      url,
      thumbnail,
    });

    setBusy(false);

    if (!result.ok) {
      handleFailure(result.status, result.message);
      // A link deleted in another tab cannot be edited: leave the form closed and
      // let the refreshed list show the truth.
      if (result.status === 404) {
        setMode("idle");
        router.refresh();
      }
      return;
    }

    setMode("idle");
    router.refresh();
  }

  async function confirmDelete(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await callApi(`/api/dashboard/links/${link.id}`, "DELETE");

    setBusy(false);

    if (!result.ok && result.status !== 404) {
      handleFailure(result.status, result.message);
      return;
    }

    setMode("idle");
    router.refresh();
  }

  async function removeFromAlbum(): Promise<void> {
    if (busy || removeFromAlbumId === undefined) return;

    setBusy(true);
    setError(null);

    const result = await callApi(
      `/api/dashboard/links/${link.id}/albums/${removeFromAlbumId}`,
      "DELETE",
    );

    setBusy(false);

    // Already out of the album is the outcome the visitor asked for.
    if (!result.ok && result.status !== 404) {
      handleFailure(result.status, result.message);
      return;
    }

    router.refresh();
  }

  if (mode === "editing") {
    return (
      <form onSubmit={saveEdit} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            required
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            maxLength={MAX_URL_LENGTH}
            required
            type="url"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          Thumbnail
          <input
            value={thumbnail}
            onChange={(event) => setThumbnail(event.target.value)}
            maxLength={MAX_URL_LENGTH}
            type="url"
            placeholder="Optional"
            className={FIELD}
          />
        </label>

        {error === null ? null : (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTitle(link.title);
              setUrl(link.url);
              setThumbnail(link.thumbnail ?? "");
              setError(null);
              setMode("idle");
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === "confirming") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-red-700 dark:text-red-400">
          Delete this link permanently?
        </p>

        {error === null ? null : (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={confirmDelete}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Confirm delete"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMode("idle");
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={busy}
          aria-pressed={link.isFavorite}
          aria-label={link.isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={link.isFavorite ? "Remove from favorites" : "Add to favorites"}
          className={`${ICON_BUTTON} ${
            link.isFavorite ? "text-amber-500 hover:text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          <StarIcon filled={link.isFavorite} />
        </button>
        {albums === undefined ? null : (
          <AddToAlbumMenu
            linkId={link.id}
            albums={albums}
            memberAlbumIds={memberAlbumIds ?? []}
            locked={locked}
          />
        )}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("editing");
          }}
          aria-label="Edit link"
          title="Edit link"
          className={ICON_BUTTON}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("confirming");
          }}
          aria-label="Delete link"
          title="Delete link"
          className={`${ICON_BUTTON} hover:text-red-600 dark:hover:text-red-400`}
        >
          <TrashIcon />
        </button>
      </div>

      {removeFromAlbumId === undefined ? null : (
        <button
          type="button"
          onClick={removeFromAlbum}
          disabled={busy}
          className="self-start rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {busy ? "Removing…" : "Remove from this album"}
        </button>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
