"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MultiCategoryFilterModal,
  type FilterCategory,
  type FilterOption,
} from "@/components/MultiCategoryFilterModal";
import type { AlbumOption } from "@/db/albums";
import { EMPTY_CATEGORY, type FilterSelection } from "@/lib/filter-selection";
import {
  buildLinksHref,
  clearLinkFilters,
  hasActiveFilters,
  type LinkFilters as FilterValues,
  type LinkView,
} from "@/lib/link-filters";

/**
 * One keystroke is not one request: the free-text search is debounced, while the
 * modal, the view switch, the favorites toggle, and the clear button apply
 * immediately because each is a deliberate action.
 */
const DEBOUNCE_MS = 250;

/**
 * The Album category's pinned special value. It lives inside the modal's normal
 * `include` list so the component's returned JSON keeps its `{ include, exclude }`
 * shape; the adapter below turns it into the `albumNone` flag.
 */
const ALBUM_NONE = "__not_in_album__";

const FIELD =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100";

const LABEL = "text-xs font-medium text-slate-600 dark:text-slate-400";

function FunnelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5.5h16l-6.25 7.3v5.2L10.25 20v-7.2L4 5.5z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
    >
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={2.5} />
    </svg>
  );
}

const VIEW_ICONS: Record<LinkView, () => React.JSX.Element> = {
  grid: GridIcon,
  list: ListIcon,
};

const VIEW_LABELS: Record<LinkView, string> = {
  grid: "Grid",
  list: "List",
};

/**
 * Domain options come from the page's scope-filtered list. A value that only
 * exists in a hand-typed URL is appended so the modal can still show and remove
 * it, instead of silently keeping an invisible filter.
 */
function buildDomainOptions(
  domains: readonly { domain: string; count: number }[],
  filters: FilterValues,
): FilterOption[] {
  const options: FilterOption[] = domains.map((option) => ({
    value: option.domain,
    label: option.domain,
    count: option.count,
  }));

  for (const value of [
    ...filters.domains.include,
    ...filters.domains.exclude,
  ]) {
    if (!options.some((option) => option.value === value)) {
      options.push({ value, label: value });
    }
  }

  return options;
}

/** The same fallback for an album id that a stale URL names after a rename/delete. */
function buildAlbumOptions(
  albums: readonly AlbumOption[],
  filters: FilterValues,
): FilterOption[] {
  const options: FilterOption[] = albums.map((album) => ({
    value: album.id,
    label: album.name,
  }));

  for (const value of [...filters.albums.include, ...filters.albums.exclude]) {
    if (!options.some((option) => option.value === value)) {
      options.push({ value, label: value });
    }
  }

  return options;
}

export interface LinkFiltersProps {
  domains: readonly { domain: string; count: number }[];
  /** Every album on this page's side, for the modal's Album category. */
  albums?: readonly AlbumOption[];
  filters: FilterValues;
  /** The light dashboard shows the lock icon; the locked page does not need it. */
  showLockButton?: boolean;
  /**
   * The Album category only makes sense where links are not already inside one
   * album: the two Links tabs. An album's own page leaves it off.
   */
  showAlbumFilter?: boolean;
}

export function LinkFilters({
  domains,
  albums = [],
  filters,
  showLockButton = false,
  showAlbumFilter = false,
}: LinkFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { query } = filters;

  const [text, setText] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);
  const [open, setOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /**
   * An immediate action must not be undone by a search that was still waiting on
   * its debounce: cancel the pending write, then navigate.
   */
  const navigateNow = useCallback(
    (next: FilterValues) => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }

      navigate(next);
    },
    [navigate],
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === query) return;

    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      navigate({ ...filters, query: trimmed });
    }, DEBOUNCE_MS);

    return () => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [filters, navigate, query, text]);

  const categories = useMemo<FilterCategory[]>(() => {
    const list: FilterCategory[] = [
      {
        id: "domain",
        label: "Domain",
        options: buildDomainOptions(domains, filters),
      },
    ];

    if (showAlbumFilter) {
      list.push({
        id: "album",
        label: "Album",
        options: buildAlbumOptions(albums, filters),
        specials: [{ value: ALBUM_NONE, label: "Not in an album" }],
      });
    }

    return list;
  }, [albums, domains, filters, showAlbumFilter]);

  const modalValue = useMemo<FilterSelection>(() => {
    const value: FilterSelection = { domain: filters.domains };

    if (showAlbumFilter) {
      value.album = filters.albumNone
        ? { include: [ALBUM_NONE], exclude: [] }
        : filters.albums;
    }

    return value;
  }, [filters, showAlbumFilter]);

  const applySelection = useCallback(
    (selection: FilterSelection) => {
      const album = selection.album ?? EMPTY_CATEGORY;
      const albumNone =
        showAlbumFilter && album.include.includes(ALBUM_NONE);

      /*
        Only the excluded (unchecked) values are persisted. Included values are
        "everything that is not excluded", so a filter never goes stale when a
        new domain or album appears — the newcomer defaults to included, which is
        exactly what the modal shows.
      */
      navigateNow({
        query: text.trim(),
        domains: {
          include: [],
          exclude: [...(selection.domain?.exclude ?? [])],
        },
        albums: albumNone
          ? EMPTY_CATEGORY
          : {
              include: [],
              exclude: album.exclude.filter((value) => value !== ALBUM_NONE),
            },
        albumNone,
        favorite: filters.favorite,
        view: filters.view,
      });
      setOpen(false);
    },
    [filters, navigateNow, showAlbumFilter, text],
  );

  const filtering = hasActiveFilters(filters);
  const activeFilterCount =
    filters.domains.include.length +
    filters.domains.exclude.length +
    (filters.albumNone
      ? 1
      : filters.albums.include.length + filters.albums.exclude.length);

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-1.5 sm:min-w-56">
          <label htmlFor="link-search" className={LABEL}>
            Search links
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              navigateNow({ ...filters, query: text.trim() });
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

        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <span className={LABEL}>Filter</span>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={`inline-flex w-full items-center justify-center gap-2 font-medium hover:bg-slate-100 sm:w-auto sm:justify-start dark:hover:bg-slate-800 ${FIELD}`}
          >
            <FunnelIcon />
            Filter
            {activeFilterCount === 0 ? null : (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <span className={LABEL}>View</span>
          <div
            role="group"
            aria-label="View mode"
            className="grid w-full grid-cols-2 rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm sm:inline-flex sm:w-auto dark:border-slate-700 dark:bg-slate-950"
          >
            {(["grid", "list"] as const).map((view) => {
              const Icon = VIEW_ICONS[view];
              const active = filters.view === view;

              return (
                <button
                  key={view}
                  type="button"
                  aria-pressed={active}
                  onClick={() => navigateNow({ ...filters, view })}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition sm:py-1.5 ${
                    active
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon />
                  {VIEW_LABELS[view]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <span className={LABEL}>Show</span>
          <button
            type="button"
            aria-pressed={filters.favorite}
            onClick={() => navigateNow({ ...filters, favorite: !filters.favorite })}
            className={`inline-flex w-full items-center justify-center gap-2 font-medium sm:w-auto sm:justify-start ${FIELD} ${
              filters.favorite
                ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300"
                : "hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill={filters.favorite ? "currentColor" : "none"}
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
            onClick={() => navigateNow(clearLinkFilters(filters))}
            className="w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:w-auto dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Clear filters
          </button>
        ) : null}

        {showLockButton ? (
          <Link
            href="/locked"
            aria-label="Locked domains"
            title="Locked domains"
            className="inline-flex h-10 w-10 items-center justify-center self-end rounded-lg border border-slate-300 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:ml-auto dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
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

      {open ? (
        <MultiCategoryFilterModal
          categories={categories}
          value={modalValue}
          onApply={applySelection}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
