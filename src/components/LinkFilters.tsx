"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  buildLinksHref,
  hasActiveFilters,
  type LinkFilters as FilterValues,
} from "@/lib/link-filters";

/**
 * One keystroke is not one request: the free-text search is debounced, while the
 * dropdown, the favorites toggle, and the clear button apply immediately because
 * each is a deliberate action.
 */
const DEBOUNCE_MS = 250;

const FIELD =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

export interface LinkFiltersProps {
  domains: readonly { domain: string; count: number }[];
  filters: FilterValues;
  /** The light dashboard shows the lock icon; the locked page does not need it. */
  showLockButton?: boolean;
}

export function LinkFilters({
  domains,
  filters,
  showLockButton = false,
}: LinkFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { query, domain, favorite } = filters;

  const [text, setText] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);

  // The URL is the source of truth. Adjusting state during render is the
  // sanctioned way to follow a changed prop (no effect, no extra render pass):
  // adopt a value that arrived from elsewhere ("Clear filters", the back button,
  // a shared link) but keep what the visitor is typing when it normalises to the
  // same search.
  if (query !== seenQuery) {
    setSeenQuery(query);

    if (text.trim() !== query) {
      setText(query);
    }
  }

  const navigate = useCallback(
    (next: FilterValues) => {
      // `scroll: false` keeps the grid from jumping under the visitor.
      router.replace(buildLinksHref(next, pathname), { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === query) return;

    const timer = setTimeout(
      () => navigate({ query: trimmed, domain, favorite }),
      DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
  }, [domain, favorite, navigate, query, text]);

  // A hand-typed `?domain=` that is not in the list would leave the select blank, so
  // offer it explicitly (without a count) instead of silently showing nothing.
  const options: readonly { domain: string; count: number | null }[] =
    domain === "" || domains.some((option) => option.domain === domain)
      ? domains
      : [...domains, { domain, count: null }];

  const filtering = hasActiveFilters(filters);

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-56">
        <label
          htmlFor="link-search"
          className="text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Search links
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ query: text.trim(), domain, favorite });
          }}
        >
          <input
            id="link-search"
            type="search"
            value={text}
            placeholder="Title, url, or domain…"
            onChange={(event) => setText(event.target.value)}
            className={`w-full ${FIELD}`}
          />
        </form>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="link-domain"
          className="text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Domain
        </label>
        <select
          id="link-domain"
          value={domain}
          onChange={(event) =>
            navigate({ query: text.trim(), domain: event.target.value, favorite })
          }
          className={`w-full bg-white sm:w-64 dark:bg-slate-950 ${FIELD}`}
        >
          <option value="">All domains</option>
          {options.map((option) => (
            <option key={option.domain} value={option.domain}>
              {option.count === null
                ? option.domain
                : `${option.domain} (${option.count})`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Show
        </span>
        <button
          type="button"
          aria-pressed={favorite}
          onClick={() => navigate({ query: text.trim(), domain, favorite: !favorite })}
          className={`inline-flex items-center gap-2 ${FIELD} font-medium ${
            favorite
              ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300"
              : "hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill={favorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          >
            <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5z" />
          </svg>
          Favorites
        </button>
      </div>

      {filtering ? (
        <button
          type="button"
          onClick={() => navigate({ query: "", domain: "", favorite: false })}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          Clear filters
        </button>
      ) : null}

      {showLockButton ? (
        <Link
          href="/locked"
          aria-label="Locked domains"
          title="Locked domains"
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
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
            <path d="M7.5 10.5V8a4.5 4.5 0 019 0v2.5" />
            <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
          </svg>
        </Link>
      ) : null}
    </div>
  );
}
