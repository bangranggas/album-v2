"use client";

import { useSelection } from "@/components/SelectionProvider";

export interface SelectAllToggleProps {
  /** The ids the current page renders, filters included. */
  visibleIds: readonly string[];
}

/**
 * "Select all on this page", above the grid.
 *
 * "All" means all of what is on screen: the rendered page is capped at 100 links
 * and narrowed by the filters, so acting on anything else would silently include
 * links the owner never saw. The box reflects three states: nothing selected, some
 * selected (indeterminate), and every rendered link selected.
 */
export function SelectAllToggle({ visibleIds }: SelectAllToggleProps) {
  const selection = useSelection();
  if (selection === null) return null;

  const selectedCount = visibleIds.filter((id) => selection.isSelected(id)).length;
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="mb-4">
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(node) => {
            if (node !== null) node.indeterminate = someSelected;
          }}
          disabled={visibleIds.length === 0}
          onChange={() => {
            if (allSelected) {
              selection.removeMany(visibleIds);
              return;
            }

            selection.selectMany(visibleIds);
          }}
          className="h-3.5 w-3.5 accent-slate-900 dark:accent-slate-100"
        />
        Select all on this page
      </label>
    </div>
  );
}
