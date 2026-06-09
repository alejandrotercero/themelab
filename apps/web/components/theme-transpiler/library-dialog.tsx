"use client";

// The in-tool "My Themes" dialog — wraps the shared LibraryGallery so saved
// themes can be opened straight into the current editor (no navigation).

import type { SavedTheme } from "@/lib/saved-themes";
import { LibraryGallery } from "@/components/library/library-gallery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Load the chosen theme into the editor. The dialog closes afterwards. */
  onOpen: (t: SavedTheme) => void;
}

export function LibraryDialog({ open, onOpenChange, onOpen }: LibraryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="tl-overlay max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>My themes</DialogTitle>
          <DialogDescription>
            Open a saved theme to keep editing it, or manage your library.
          </DialogDescription>
        </DialogHeader>
        <LibraryGallery
          gridClassName="grid-cols-2 sm:grid-cols-3"
          onOpen={(t) => {
            onOpen(t);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
