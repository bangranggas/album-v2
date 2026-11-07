"use client";

import { useEffect, useState } from "react";

import {
  categorySelection,
  countCategory,
  countSelection,
  isColumnComplete,
  isColumnPartial,
  setAllIncluded,
  toggleMembership,
  toggleSpecial,
  type CategorySelection,
  type FilterColumn,
  type FilterSelection,
} from "@/lib/filter-selection";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional count shown on the right of the label, e.g. a domain's links. */
  count?: number;
}

export interface FilterCategory {
  id: string;
  label: string;
  options: readonly FilterOption[];
  /**
   * Pinned toggles such as "Not in an album". Checking one includes only it and
   * pushes every ordinary option to the excluded side; checking an ordinary
   * option clears the special. The value still travels in the category's
   * `include` list, so the returned JSON keeps its shape.
   */
  specials?: readonly FilterOption[];
}

export interface MultiCategoryFilterModalProps {
  categories: readonly FilterCategory[];
  value: FilterSelection;
  onApply: (value: FilterSelection) => void;
  onClose: () => void;
  title?: string;
}

const COLUMN_COPY: Record<FilterColumn, string> = {
  include: "Include",
  exclude: "Exclude",
};

const COLUMN_ACCENT: Record<FilterColumn, string> = {
  include:
    "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
  exclude: "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30",
};

const COLUMN_DOT: Record<FilterColumn, string> = {
  include: "bg-emerald-500",
  exclude: "bg-red-500",
};

const COUNT_BADGE =
  "shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300";

/**
 * A category's starting state. Every ordinary option must end up on exactly one
 * side, so the columns always mirror each other.
 *
 * - No committed filters → every option included (checked): a fresh modal
 *   filters nothing until something is unchecked.
 * - Committed excludes → those options stay excluded, the rest included.
 * - A legacy whitelist (`?domain=a`) → only those options included, all the
 *   others pushed to the excluded side, so the selection is never half-guessed.
 */
function initialCategorySelection(
  committed: CategorySelection,
  options: readonly string[],
  specials: readonly FilterOption[] | undefined,
): CategorySelection {
  const specialValues = new Set((specials ?? []).map((special) => special.value));
  const optionSet = new Set(options);
  const excluded = new Set(committed.exclude);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const value of committed.include) {
    if (specialValues.has(value) || optionSet.has(value)) {
      include.push(value);
    }
  }

  for (const value of committed.exclude) {
    if (specialValues.has(value) || optionSet.has(value)) {
      exclude.push(value);
    }
  }

  const isWhitelist = committed.include.some(
    (value) => optionSet.has(value) || specialValues.has(value),
  );

  for (const value of options) {
    if (include.includes(value) || exclude.includes(value)) continue;

    if (isWhitelist) {
      exclude.push(value);
    } else {
      include.push(value);
    }
  }

  return { include, exclude };
}

function initialSelection(
  value: FilterSelection,
  categories: readonly FilterCategory[],
): FilterSelection {
  const draft: FilterSelection = {};

  for (const category of categories) {
    draft[category.id] = initialCategorySelection(
      categorySelection(value, category.id),
      category.options.map((option) => option.value),
      category.specials,
    );
  }

  return draft;
}

/** Drops a category's special values, so an ordinary option can take over. */
function withoutSpecials(
  current: CategorySelection,
  specials: readonly FilterOption[] | undefined,
): CategorySelection {
  if (specials === undefined || specials.length === 0) return current;

  const values = new Set(specials.map((special) => special.value));

  return {
    include: current.include.filter((value) => !values.has(value)),
    exclude: current.exclude.filter((value) => !values.has(value)),
  };
}

/**
 * The generic multi-category filter modal.
 *
 * It is controlled only through its props: the parent passes the committed value
 * and receives a whole new value on Apply. The component never filters a list or
 * touches the URL itself; it is a pure editor over `FilterSelection`.
 *
 * Each option is either checked (Include, left) or unchecked (Exclude, right); a
 * fresh modal starts with every option checked. Toggle moves the value between
 * the columns, "All" moves the visible set, and the two columns scroll
 * independently.
 */
export function MultiCategoryFilterModal({
  categories,
  value,
  onApply,
  onClose,
  title = "Filter",
}: MultiCategoryFilterModalProps) {
  const [draft, setDraft] = useState<FilterSelection>(() =>
    initialSelection(value, categories),
  );
  const [activeId, setActiveId] = useState(categories[0]?.id ?? "");
  const [search, setSearch] = useState("");

  const selectedCategory =
    categories.find((category) => category.id === activeId) ?? categories[0];

  // Escape closes, and the page behind the modal cannot scroll while it is open.
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (selectedCategory === undefined) return null;

  const active = selectedCategory;
  const current = categorySelection(draft, active.id);
  const needle = search.trim().toLowerCase();
  const matches = (option: FilterOption) =>
    needle === "" ||
    option.label.toLowerCase().includes(needle) ||
    option.value.toLowerCase().includes(needle);

  const visibleOptions = active.options.filter((option) => matches(option));
  const visibleValues = visibleOptions.map((option) => option.value);
  const allChecked = isColumnComplete(current, visibleValues, "include");
  const someChecked = isColumnPartial(current, visibleValues, "include");
  const totalExcluded = countSelection(draft);

  function updateCategory(
    updater: (category: CategorySelection) => CategorySelection,
  ): void {
    setDraft((previous) => ({
      ...previous,
      [active.id]: updater(categorySelection(previous, active.id)),
    }));
  }

  function selectCategory(categoryId: string): void {
    setActiveId(categoryId);
    setSearch("");
  }

  function handleToggle(value: string): void {
    updateCategory((category) =>
      toggleMembership(withoutSpecials(category, active.specials), value),
    );
  }

  function handleAll(included: boolean): void {
    updateCategory((category) =>
      setAllIncluded(withoutSpecials(category, active.specials), visibleValues, included),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close filter"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        className="relative flex h-[min(85vh,40rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h2
            id="filter-modal-title"
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close filter"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Filter categories"
            className="shrink-0 border-b border-slate-200 bg-slate-50 p-2 sm:w-40 sm:overflow-y-auto sm:border-b-0 sm:border-r dark:border-slate-700 dark:bg-slate-950/40"
          >
            <ul className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible">
              {categories.map((category) => {
                const isActive = category.id === active.id;
                const excluded = countCategory(
                  categorySelection(draft, category.id),
                );

                return (
                  <li key={category.id} className="shrink-0 sm:shrink">
                    <button
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => selectCategory(category.id)}
                      className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition sm:w-full ${
                        isActive
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      }`}
                    >
                      <span className="truncate">{category.label}</span>
                      {excluded === 0 ? null : (
                        <span
                          className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] ${
                            isActive
                              ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-900"
                              : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {excluded}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:overflow-hidden">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${active.label.toLowerCase()}…`}
                aria-label={`Search ${active.label}`}
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 sm:max-w-64 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-100 dark:focus:ring-slate-100"
              />

              <label className="inline-flex cursor-pointer items-center gap-2 self-start text-xs font-medium text-slate-600 sm:self-auto dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(node) => {
                    if (node !== null) node.indeterminate = someChecked;
                  }}
                  disabled={visibleValues.length === 0}
                  onChange={() => handleAll(allChecked ? false : true)}
                  className="h-4 w-4 accent-slate-900 disabled:opacity-40 sm:h-3.5 sm:w-3.5 dark:accent-slate-100"
                />
                All
              </label>
            </div>

            {active.specials === undefined || active.specials.length === 0 ? null : (
              <div className="flex flex-wrap gap-2">
                {active.specials.map((special) => {
                  const checked = current.include.includes(special.value);

                  return (
                    <button
                      key={special.value}
                      type="button"
                      aria-pressed={checked}
                      onClick={() =>
                        updateCategory((category) =>
                          toggleSpecial(category, special.value, !checked),
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                        checked
                          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      {checked ? (
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12.5l4.5 4.5L19 7" />
                        </svg>
                      ) : null}
                      {special.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:min-h-0 sm:flex-1 sm:grid-cols-2 sm:grid-rows-1">
              {(["include", "exclude"] as const).map((column) => (
                <div
                  key={column}
                  className={`flex h-52 min-h-0 flex-col rounded-xl border sm:h-full ${COLUMN_ACCENT[column]}`}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2.5 dark:border-slate-700/70">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${COLUMN_DOT[column]}`}
                      />
                      {COLUMN_COPY[column]}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {current[column].length}
                    </span>
                  </div>

                  <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                    {visibleOptions.length === 0 ? (
                      <li className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        No values match your search.
                      </li>
                    ) : (
                      visibleOptions
                        .filter((option) => current[column].includes(option.value))
                        .map((option) => (
                          <li key={option.value}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-white/70 sm:py-1.5 dark:hover:bg-slate-800/70">
                              <input
                                type="checkbox"
                                checked={column === "include"}
                                onChange={() => handleToggle(option.value)}
                                className="h-4 w-4 shrink-0 cursor-pointer accent-slate-900 sm:h-3.5 sm:w-3.5 dark:accent-slate-100"
                              />
                              <span
                                className="min-w-0 flex-1 truncate text-sm text-slate-700 sm:text-xs dark:text-slate-200"
                                title={option.label}
                              >
                                {option.label}
                              </span>
                              {option.count === undefined ? null : (
                                <span className={COUNT_BADGE}>{option.count}</span>
                              )}
                            </label>
                          </li>
                        ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setDraft(initialSelection({}, categories))}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Clear filter
          </button>

          <button
            type="button"
            onClick={() => onApply(draft)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 dark:focus-visible:outline-slate-100"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4 4" />
            </svg>
            Apply
            {totalExcluded === 0 ? null : ` (${totalExcluded})`}
          </button>
        </footer>
      </div>
    </div>
  );
}