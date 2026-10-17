"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { callApi } from "@/lib/dashboard-api";
import { MAX_TITLE_LENGTH, MAX_URL_LENGTH } from "@/lib/validation";

const FIELD =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

/** Mirrors the server's derivation, only to explain what will happen. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export interface AddLinkFormProps {
  /**
   * On the locked page: the domains that are currently hidden. A link saved to
   * any other domain would appear on the light dashboard, so the form says so.
   */
  lockedDomains?: readonly string[];
}

/** Adds a link by hand, without the Tampermonkey script. */
export function AddLinkForm({ lockedDomains }: AddLinkFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onLockedPage = lockedDomains !== undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await callApi("/api/dashboard/links", "POST", {
      url,
      title,
      thumbnail,
    });

    setBusy(false);

    if (!result.ok) {
      if (result.status === 401 && onLockedPage) {
        router.push("/locked/unlock");
        return;
      }

      setError(result.message);
      return;
    }

    const domain = hostOf(url);
    setUrl("");
    setTitle("");
    setThumbnail("");
    setNotice(
      !onLockedPage
        ? "Link saved."
        : domain !== null && lockedDomains.includes(domain)
          ? `Link saved to ${domain}, which is hidden.`
          : `Link saved to ${domain ?? "an unknown domain"}, which is not locked, so it also shows on All links. Lock it below to hide it.`,
    );
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
          <span aria-hidden="true">+</span> Add link
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            required
            placeholder="https://example.com/article"
            maxLength={MAX_URL_LENGTH}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional — derived from the URL"
            maxLength={MAX_TITLE_LENGTH}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 sm:col-span-2">
          Thumbnail
          <input
            value={thumbnail}
            onChange={(event) => setThumbnail(event.target.value)}
            type="url"
            placeholder="Optional image URL"
            maxLength={MAX_URL_LENGTH}
            className={FIELD}
          />
        </label>
      </div>

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
          {busy ? "Saving…" : "Save link"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
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
