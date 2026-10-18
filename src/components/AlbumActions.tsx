"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { callApi } from "@/lib/dashboard-api";
import { MAX_ALBUM_NAME_LENGTH } from "@/lib/validation";

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

export interface AlbumActionsProps {
  albumId: string;
  name: string;
  /** True on the locked page, so an expired passcode sends the visitor back. */
  locked?: boolean;
}

/**
 * Rename and delete for one album.
 *
 * Both are inline, in the card: rename is a form, delete is a two-step confirm.
 * No dialog and no `window.confirm` — the project keeps every confirmation inside
 * the page (the same reason the login form is a page rather than a browser prompt).
 */
export function AlbumActions({ albumId, name, locked = false }: AlbumActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "editing" | "confirming">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(name);
  const [seenName, setSeenName] = useState(name);

  // A rename that landed elsewhere (another tab, another page) wins over the
  // draft: the server's value is the truth, as in `LinkFilters`.
  if (name !== seenName) {
    setSeenName(name);
    setDraft(name);
  }

  function handleFailure(status: number, message: string): void {
    if (status === 401 && locked) {
      router.push("/locked/unlock");
      return;
    }

    setError(message);
  }

  async function saveRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await callApi(`/api/dashboard/albums/${albumId}`, "PATCH", {
      name: draft,
    });

    setBusy(false);

    if (!result.ok) {
      handleFailure(result.status, result.message);
      // The album was deleted in another tab: close the form and let the refreshed
      // list tell the truth.
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

    const result = await callApi(`/api/dashboard/albums/${albumId}`, "DELETE");

    setBusy(false);

    // Already gone is the outcome the visitor asked for.
    if (!result.ok && result.status !== 404) {
      handleFailure(result.status, result.message);
      return;
    }

    setMode("idle");
    router.refresh();
  }

  if (mode === "editing") {
    return (
      <form onSubmit={saveRename} className="flex w-full flex-col gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          Album name
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_ALBUM_NAME_LENGTH}
            required
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
              setDraft(name);
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
      <div className="flex w-full flex-col gap-2">
        <p className="text-xs font-medium text-red-700 dark:text-red-400">
          Delete this album? Its links stay on the list.
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
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("editing");
          }}
          aria-label={`Rename ${name}`}
          title="Rename album"
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
          aria-label={`Delete ${name}`}
          title="Delete album"
          className={`${ICON_BUTTON} hover:text-red-600 dark:hover:text-red-400`}
        >
          <TrashIcon />
        </button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
