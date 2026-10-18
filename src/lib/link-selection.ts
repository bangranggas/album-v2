/**
 * The pure half of bulk selection: which links are selected, how much of that
 * selection the page is showing, and what to say after an album received them.
 *
 * None of this touches React or the network, so the rules the bar and the
 * checkbox enforce can be tested on their own — the components only wire props
 * to these functions.
 */

/** Adds `id` when it is not selected, removes it when it is. */
export function toggleSelection(
  selected: readonly string[],
  id: string,
): string[] {
  return selected.includes(id)
    ? selected.filter((candidate) => candidate !== id)
    : [...selected, id];
}

/**
 * Unions `ids` into the selection, deduplicating and keeping first-seen order.
 *
 * "Select all on this page" runs through this, so clicking it twice cannot grow
 * the selection.
 */
export function addToSelection(
  selected: readonly string[],
  ids: readonly string[],
): string[] {
  const next = [...selected];

  for (const id of ids) {
    if (!next.includes(id)) next.push(id);
  }

  return next;
}

/**
 * Removes every id in `ids` from the selection.
 *
 * "Select all on this page" uses this to uncheck itself: only the links the page
 * is showing are dropped, so a selection that is partly out of view survives.
 */
export function removeFromSelection(
  selected: readonly string[],
  ids: readonly string[],
): string[] {
  const removed = new Set(ids);

  return selected.filter((id) => !removed.has(id));
}

/**
 * Splits the selection by what the current page renders.
 *
 * The selection survives a filter change (a link that was selected and then
 * filtered out stays selected), so the bar has to be able to say how many of the
 * selected links are not on screen. Both lists follow the selection's own order,
 * which is the order the owner clicked in.
 */
export function partitionSelection(
  selected: readonly string[],
  visibleIds: readonly string[],
): { visible: string[]; outOfView: string[] } {
  const visibleSet = new Set(visibleIds);

  return {
    visible: selected.filter((id) => visibleSet.has(id)),
    outOfView: selected.filter((id) => !visibleSet.has(id)),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The action bar's headline: `"7 links selected · 2 links out of view"`. */
export function selectionLabel(
  selectedCount: number,
  outOfViewCount: number,
): string {
  if (selectedCount === 0) return "Nothing selected";

  const base = `${plural(selectedCount, "link")} selected`;

  return outOfViewCount > 0
    ? `${base} · ${plural(outOfViewCount, "link")} out of view`
    : base;
}

/** What a bulk add did, as `addLinksToAlbum` reports it. */
export interface BulkAddCounts {
  added: number;
  alreadyIn: number;
  skipped: number;
}

/**
 * The line the bar shows after a bulk add. Every count that is not zero gets its
 * own clause, and a run that added nothing says so instead of claiming success.
 */
export function bulkAddReport(counts: BulkAddCounts, albumName: string): string {
  const { added, alreadyIn, skipped } = counts;
  const parts: string[] = [];

  if (added > 0) {
    parts.push(`${plural(added, "link")} added to “${albumName}”`);
  } else if (alreadyIn > 0) {
    parts.push(
      `${plural(alreadyIn, "link")} ${alreadyIn === 1 ? "was" : "were"} already in “${albumName}”`,
    );
  }

  if (added > 0 && alreadyIn > 0) {
    parts.push(`${alreadyIn} already there`);
  }

  if (skipped > 0) {
    parts.push(`${plural(skipped, "link")} skipped`);
  }

  if (parts.length === 0) return "Nothing added";

  return added > 0 ? parts.join(", ") : `Nothing added: ${parts.join(", ")}`;
}
