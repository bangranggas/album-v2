"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  buildLinksHref,
  hasActiveFilters,
} from "@/lib/link-filters";

/**
 * One keystroke is not one request: the free-text search is debounced, while the
 * dropdown applies immediately because choosing a domain is a deliberate action.
 */
const DEBOUNCE_MS = 250;

export interface LinkFiltersProps {
  domains: readonly { domain: string; count: number }[];
  query: string;
  domain: string;
}

export function LinkFilters({ domains, query, domain }: LinkFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
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
    (nextQuery: string, nextDomain: string) => {
      // `scroll: false` keeps the grid from jumping under the visitor.
      router.replace(
        buildLinksHref({ query: nextQuery, domain: nextDomain }, pathname),
        { scroll: false },
      );
    },
    [pathname, router],
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === query) return;

    const timer = setTimeout(() => navigate(trimmed, domain), DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [domain, navigate, query, text]);

  // A hand-typed `?domain=` that is not in the list would leave the select blank, so
  // offer it explicitly (without a count) instead of silently showing nothing.
  const options: readonly { domain: string; count: number | null }[] =
    domain === "" || domains.some((option) => option.domain === domain)
      ? domains
      : [...domains, { domain, count: null }];

  const filtering = hasActiveFilters({ query, domain });

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-56">
        <label
          htmlFor="link-search"
          className="text-xs font-medium text-slate-600"
        >
          Search links
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            navigate(text.trim(), domain);
          }}
        >
          <input
            id="link-search"
            type="search"
            value={text}
            placeholder="Title, url, or domain…"
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
          />
        </form>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="link-domain"
          className="text-xs font-medium text-slate-600"
        >
          Domain
        </label>
        <select
          id="link-domain"
          value={domain}
          onChange={(event) => navigate(text.trim(), event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 sm:w-64"
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

      {filtering ? (
        <button
          type="button"
          onClick={() => navigate("", "")}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
