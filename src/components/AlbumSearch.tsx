"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { buildAlbumsHref } from "@/lib/link-filters";

/** One keystroke is not one request: the album search is debounced, like the links one. */
const DEBOUNCE_MS = 250;

const FIELD =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

export interface AlbumSearchProps {
  /** The `aq` value currently in the URL, which is the source of truth. */
  query: string;
}

/**
 * The album-name search box.
 *
 * It writes `aq` (not `q`) and always carries `tab=albums` with it, so a search can
 * neither filter the links tab nor be lost by landing on it.
 */
export function AlbumSearch({ query }: AlbumSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);

  // Follow a value that arrived from elsewhere ("Clear search", the back button)
  // while keeping what the visitor is typing when it normalises to the same search.
  // Adjusting state during render is the sanctioned way to do this — see LinkFilters.
  if (query !== seenQuery) {
    setSeenQuery(query);

    if (text.trim() !== query) {
      setText(query);
    }
  }

  const navigate = useCallback(
    (next: string) => {
      // The current path is the base, exactly as the links filter bar does it, so
      // `/` and `/locked` keep their own search without the page passing a flag.
      router.replace(buildAlbumsHref(next, pathname), { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === query) return;

    const timer = setTimeout(() => navigate(trimmed), DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [navigate, query, text]);

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-md">
        <label
          htmlFor="album-search"
          className="text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Search albums
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate(text.trim());
          }}
        >
          <input
            id="album-search"
            type="search"
            value={text}
            placeholder="Album name…"
            onChange={(event) => setText(event.target.value)}
            className={FIELD}
          />
        </form>
      </div>

      {query === "" ? null : (
        <button
          type="button"
          onClick={() => navigate("")}
          className="self-start rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          Clear search
        </button>
      )}
    </div>
  );
}
