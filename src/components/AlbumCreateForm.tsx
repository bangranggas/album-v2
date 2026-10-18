"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { callApi } from "@/lib/dashboard-api";
import { MAX_ALBUM_NAME_LENGTH } from "@/lib/validation";

const FIELD =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

export interface AlbumCreateFormProps {
  /** True on the locked page, so an expired passcode sends the visitor back. */
  locked?: boolean;
}

/** Creates an album from the Albums tab, without leaving the page. */
export function AlbumCreateForm({ locked = false }: AlbumCreateFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await callApi("/api/dashboard/albums", "POST", { name });

    setBusy(false);

    if (!result.ok) {
      if (result.status === 401 && locked) {
        router.push("/locked/unlock");
        return;
      }

      setError(result.message);
      return;
    }

    setName("");
    setNotice(`Album “${name.trim()}” created.`);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <span aria-hidden="true">+</span> New album
        </button>

        {notice === null ? null : (
          <p className="text-xs text-slate-600 dark:text-slate-400">{notice}</p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 sm:max-w-sm">
        Album name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={MAX_ALBUM_NAME_LENGTH}
          placeholder="Anime, Read later, Podcasts…"
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
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {busy ? "Creating…" : "Create album"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setName("");
            setError(null);
            setOpen(false);
            setNotice(null);
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
