"use client";

// Toolbar controls shared by all three tools: Save (to the localStorage library)
// and "My Themes" (open the library dialog). Save updates in place when the
// current theme came from the library, otherwise it prompts for a name. Driven
// entirely off the shared useThemeEditor instance.

import { useState } from "react";
import { BookmarkSimpleIcon, FloppyDiskIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { savedThemesStore, type SavedTheme } from "@/lib/saved-themes";
import type { useThemeEditor } from "./use-theme-editor";
import { NameThemeDialog } from "./name-theme-dialog";
import { LibraryDialog } from "./library-dialog";

interface LibraryControlsProps {
  editor: ReturnType<typeof useThemeEditor>;
}

export function LibraryControls({ editor }: LibraryControlsProps) {
  const [nameOpen, setNameOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const save = () => {
    if (editor.savedId && savedThemesStore.get(editor.savedId)) {
      savedThemesStore.update(editor.savedId, {
        theme: editor.theme,
        radius: editor.radius,
        source: editor.source,
      });
      toast.success("Theme updated");
      return;
    }
    // No saved entry yet (fresh generation/import) — ask for a name.
    setNameOpen(true);
  };

  const saveNew = (name: string) => {
    const created = savedThemesStore.saveNew({
      name,
      theme: editor.theme,
      radius: editor.radius,
      source: editor.source,
    });
    editor.setSavedId(created.id);
    toast.success("Theme saved");
  };

  const open = (t: SavedTheme) => {
    editor.loadBase(t.theme, { source: t.name, swatches: [], savedId: t.id });
    editor.setRadius(t.radius);
  };

  return (
    <>
      <button type="button" className="ov-btn" onClick={() => setLibraryOpen(true)}>
        <BookmarkSimpleIcon weight="bold" className="size-3.5" />
        My themes
      </button>
      <button type="button" className="ov-btn" onClick={save}>
        <FloppyDiskIcon weight="bold" className="size-3.5" />
        Save
      </button>

      <NameThemeDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        initialName={editor.source || "Untitled theme"}
        onConfirm={saveNew}
      />
      <LibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} onOpen={open} />
    </>
  );
}
