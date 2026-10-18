"use client";

import { useSelection } from "@/components/SelectionProvider";

export interface SelectCheckboxProps {
  linkId: string;
  /** The link's title, for the checkbox's accessible name. */
  label: string;
}

/**
 * One card's selection checkbox, drawn over the cover.
 *
 * It renders nothing when there is no selection context, so the album detail
 * pages — the other callers of the same card — keep their current layout without
 * a prop threaded through them.
 */
export function SelectCheckbox({ linkId, label }: SelectCheckboxProps) {
  const selection = useSelection();
  if (selection === null) return null;

  return (
    <span className="absolute left-2 top-2 z-10 rounded bg-white/90 p-0.5 shadow-sm dark:bg-slate-950/90">
      <input
        type="checkbox"
        checked={selection.isSelected(linkId)}
        onChange={() => selection.toggle(linkId)}
        aria-label={`Select ${label}`}
        className="block h-4 w-4 cursor-pointer rounded accent-slate-900 dark:accent-slate-100"
      />
    </span>
  );
}
