"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  addToSelection,
  removeFromSelection,
  toggleSelection,
} from "@/lib/link-selection";

export interface SelectionContextValue {
  /** The selected link ids, in the order they were selected. */
  selectedIds: readonly string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Unions ids into the selection (`Select all`). */
  selectMany: (ids: readonly string[]) => void;
  /** Drops ids from the selection (`uncheck Select all`). */
  removeMany: (ids: readonly string[]) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Holds the bulk selection for one page.
 *
 * The state lives here, above the card grid, so it survives the `router.refresh()`
 * that follows every card action: the selection is not tied to a link's DOM node,
 * and a link selected before a refresh stays selected after it.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => toggleSelection(current, id));
  }, []);

  const selectMany = useCallback((ids: readonly string[]) => {
    setSelectedIds((current) => addToSelection(current, ids));
  }, []);

  const removeMany = useCallback((ids: readonly string[]) => {
    setSelectedIds((current) => removeFromSelection(current, ids));
  }, []);

  const clear = useCallback(() => setSelectedIds([]), []);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selectedIds,
      isSelected: (id: string) => selectedIds.includes(id),
      toggle,
      selectMany,
      removeMany,
      clear,
    }),
    [clear, removeMany, selectMany, selectedIds, toggle],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

/**
 * `null` outside a `SelectionProvider`, which is how a card can be rendered on a
 * page without bulk selection and simply show no checkbox.
 */
export function useSelection(): SelectionContextValue | null {
  return useContext(SelectionContext);
}
