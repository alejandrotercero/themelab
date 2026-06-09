"use client";

// React binding for the saved-themes store. Subscribes via useSyncExternalStore
// (so it re-renders on save/delete/favorite and on cross-tab storage events) and
// returns the display-sorted list plus the store actions.

import { useMemo, useSyncExternalStore } from "react";
import { savedThemesStore, type SavedTheme } from "@/lib/saved-themes";

export type { SavedTheme };

export function useSavedThemes() {
  const themes = useSyncExternalStore(
    savedThemesStore.subscribe,
    savedThemesStore.getSnapshot,
    savedThemesStore.getServerSnapshot,
  );

  // Sort here (not in the store) so getSnapshot keeps a stable reference.
  const sorted = useMemo(
    () =>
      [...themes].sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      }),
    [themes],
  );

  return {
    themes: sorted,
    saveNew: savedThemesStore.saveNew.bind(savedThemesStore),
    update: savedThemesStore.update.bind(savedThemesStore),
    rename: savedThemesStore.rename.bind(savedThemesStore),
    duplicate: savedThemesStore.duplicate.bind(savedThemesStore),
    remove: savedThemesStore.remove.bind(savedThemesStore),
    toggleFavorite: savedThemesStore.toggleFavorite.bind(savedThemesStore),
  };
}
