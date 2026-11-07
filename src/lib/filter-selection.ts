/**
 * Pure state rules for the multi-category filter modal.
 *
 * Every value in a category is either included (checked) or excluded
 * (unchecked) — there is no third state. A fresh category starts with every
 * option included, which filters nothing. The two column lists stay disjoint by
 * construction: toggling a value always moves it between them, and "All" moves
 * the whole visible set.
 *
 * A pinned special option ("Not in an album") follows the same rules but is
 * exclusive with the ordinary options: turning it on pushes every ordinary value
 * to the excluded side.
 */

export type FilterColumn = "include" | "exclude";

export interface CategorySelection {
  include: string[];
  exclude: string[];
}

/** One entry per category id, exactly the shape the modal returns on Apply. */
export type FilterSelection = Record<string, CategorySelection>;

export const EMPTY_CATEGORY: CategorySelection = { include: [], exclude: [] };

export function emptyCategory(): CategorySelection {
  return { include: [], exclude: [] };
}

export function emptySelection(categoryIds: readonly string[]): FilterSelection {
  return Object.fromEntries(categoryIds.map((id) => [id, emptyCategory()]));
}

export function cloneSelection(selection: FilterSelection): FilterSelection {
  return Object.fromEntries(
    Object.entries(selection).map(([id, value]) => [
      id,
      { include: [...value.include], exclude: [...value.exclude] },
    ]),
  );
}

/** A category's selection, or an empty one when the category is new. */
export function categorySelection(
  selection: FilterSelection,
  categoryId: string,
): CategorySelection {
  return selection[categoryId] ?? EMPTY_CATEGORY;
}

export function hasCategorySelection(value: CategorySelection): boolean {
  return value.include.length > 0 || value.exclude.length > 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Flips one value between the two sides. An included (checked) value becomes
 * excluded, and an excluded (unchecked) value becomes included. The value can
 * never be on both sides.
 */
export function toggleMembership(
  current: CategorySelection,
  value: string,
): CategorySelection {
  const included = current.include.includes(value);

  if (included) {
    return {
      include: current.include.filter((entry) => entry !== value),
      exclude: [...current.exclude, value],
    };
  }

  return {
    include: [...current.include, value],
    exclude: current.exclude.filter((entry) => entry !== value),
  };
}

/**
 * Applies the "All" control to the values the search currently shows. Checking
 * it includes every such value; clearing it excludes every such value.
 */
export function setAllIncluded(
  current: CategorySelection,
  values: readonly string[],
  included: boolean,
): CategorySelection {
  const targets = new Set(values);

  if (included) {
    return {
      include: unique([
        ...current.include,
        ...values.filter((value) => !current.include.includes(value)),
      ]),
      exclude: current.exclude.filter((value) => !targets.has(value)),
    };
  }

  return {
    include: current.include.filter((value) => !targets.has(value)),
    exclude: unique([
      ...current.exclude,
      ...values.filter((value) => !current.exclude.includes(value)),
    ]),
  };
}

/**
 * Toggles a pinned special option ("Not in an album"). A special is exclusive
 * with every ordinary value: checking it moves everything else to the excluded
 * side, so the columns still show the whole list; unchecking it removes only the
 * special itself.
 */
export function toggleSpecial(
  current: CategorySelection,
  value: string,
  checked: boolean,
): CategorySelection {
  if (!checked) {
    return {
      include: current.include.filter((entry) => entry !== value),
      exclude: [...current.exclude],
    };
  }

  return {
    include: [value],
    exclude: unique([...current.exclude, ...current.include]),
  };
}

export function isColumnComplete(
  current: CategorySelection,
  values: readonly string[],
  column: FilterColumn,
): boolean {
  return values.length > 0 && values.every((value) => current[column].includes(value));
}

export function isColumnPartial(
  current: CategorySelection,
  values: readonly string[],
  column: FilterColumn,
): boolean {
  const selected = values.filter((value) => current[column].includes(value)).length;

  return selected > 0 && selected < values.length;
}

/**
 * How many values are filtered out of this category. With the default-all model
 * this is the excluded count: included values are simply "not filtered".
 */
export function countCategory(current: CategorySelection): number {
  return current.exclude.length;
}

export function countSelection(selection: FilterSelection): number {
  return Object.values(selection).reduce(
    (total, current) => total + countCategory(current),
    0,
  );
}