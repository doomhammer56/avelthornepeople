"use client";

import { useCallback, useMemo, useState } from "react";

// Row selection for one page of a table. The selection is tied to `resetKey`
// (page, filters, page size), so it is dropped whenever the visible rows change
// instead of silently acting on rows the user can no longer see.
export function useRowSelection(ids: readonly string[], resetKey: string) {
  const [state, setState] = useState<{ key: string; ids: ReadonlySet<string> }>(
    { key: resetKey, ids: new Set() },
  );
  const current = useMemo(() => {
    if (state.key !== resetKey) return new Set<string>();
    const visible = new Set(ids);
    // Rows that disappeared (deleted, filtered by a refetch) are never acted on.
    return new Set([...state.ids].filter((id) => visible.has(id)));
  }, [state, resetKey, ids]);

  const toggle = useCallback(
    (id: string) =>
      setState((previous) => {
        const next = new Set(previous.key === resetKey ? previous.ids : []);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { key: resetKey, ids: next };
      }),
    [resetKey],
  );
  const clear = useCallback(
    () => setState({ key: resetKey, ids: new Set() }),
    [resetKey],
  );
  const allSelected = ids.length > 0 && current.size === ids.length;
  const toggleAll = useCallback(
    () =>
      setState({
        key: resetKey,
        ids: allSelected ? new Set() : new Set(ids),
      }),
    [resetKey, ids, allSelected],
  );

  return {
    selected: current,
    count: current.size,
    allSelected,
    someSelected: current.size > 0 && !allSelected,
    isSelected: (id: string) => current.has(id),
    toggle,
    toggleAll,
    clear,
  };
}
