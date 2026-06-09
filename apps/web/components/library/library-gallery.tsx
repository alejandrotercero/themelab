"use client";

// The reusable saved-themes grid: All / ★ Favorites filter, a grid of cards, an
// empty state, and the shared Rename + Delete-confirm dialogs. Used both inside
// the in-tool "My Themes" dialog and on the standalone /library page. `onOpen`
// decides what opening a theme does (load into the current editor vs. route to
// /edit).

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSavedThemes, type SavedTheme } from "@/hooks/use-saved-themes";
import { SavedThemeCard } from "@/components/theme-transpiler/saved-theme-card";
import { NameThemeDialog } from "@/components/theme-transpiler/name-theme-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Filter = "all" | "favorites";

interface LibraryGalleryProps {
  onOpen: (t: SavedTheme) => void;
  /** Tailwind grid-template-columns classes; tune per surface. */
  gridClassName?: string;
}

export function LibraryGallery({
  onOpen,
  gridClassName = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
}: LibraryGalleryProps) {
  const { themes, rename, duplicate, remove, toggleFavorite } = useSavedThemes();
  const [filter, setFilter] = useState<Filter>("all");
  const [renameTarget, setRenameTarget] = useState<SavedTheme | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedTheme | null>(null);

  const visible = filter === "favorites" ? themes.filter((t) => t.favorite) : themes;
  const favCount = themes.filter((t) => t.favorite).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="ov-seg w-fit" role="tablist" aria-label="Filter themes">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          data-active={filter === "all"}
          className="ov-seg-btn"
          onClick={() => setFilter("all")}
        >
          All ({themes.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "favorites"}
          data-active={filter === "favorites"}
          className="ov-seg-btn"
          onClick={() => setFilter("favorites")}
        >
          ★ Favorites ({favCount})
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--ov-radius-sm)] border border-dashed border-[var(--ov-border)] px-6 py-12 text-center">
          <p className="text-sm font-medium text-[var(--ov-text)]">
            {themes.length === 0 ? "No saved themes yet" : "No favorites yet"}
          </p>
          <p className="text-xs text-[var(--ov-text-dim)]">
            {themes.length === 0 ? (
              <>
                Generate one in the{" "}
                <Link href="/create" className="underline hover:text-[var(--ov-text)]">
                  theme creator
                </Link>{" "}
                and press Save.
              </>
            ) : (
              "Tap the star on a theme to favorite it."
            )}
          </p>
        </div>
      ) : (
        <div className={`grid gap-3 ${gridClassName}`}>
          {visible.map((t) => (
            <SavedThemeCard
              key={t.id}
              theme={t}
              onOpen={onOpen}
              onRename={setRenameTarget}
              onDuplicate={(theme) => {
                const copy = duplicate(theme.id);
                if (copy) toast.success(`Duplicated "${theme.name}"`);
              }}
              onDelete={setDeleteTarget}
              onToggleFavorite={(theme) => toggleFavorite(theme.id)}
            />
          ))}
        </div>
      )}

      <NameThemeDialog
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
        initialName={renameTarget?.name ?? ""}
        title="Rename theme"
        description="Choose a new name for this theme."
        confirmLabel="Rename"
        onConfirm={(name) => {
          if (renameTarget) {
            rename(renameTarget.id, name);
            toast.success("Renamed");
          }
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="tl-overlay sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete theme?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will be removed from your library. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="ov-btn" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="ov-btn"
              style={{ color: "#fff", background: "var(--ov-danger)", borderColor: "var(--ov-danger)" }}
              onClick={() => {
                if (deleteTarget) {
                  remove(deleteTarget.id);
                  toast.success(`Deleted "${deleteTarget.name}"`);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
