"use client";

// Import dialog for /edit: paste a shadcn theme export — the CSS (`:root` +
// `.dark`) or the dual-mode JSON (`{ root, dark }`) — and load it into the
// editor. Parsing is the shared `parseThemeInput`, so it accepts exactly what
// the studio (and the overlay) emit.

import { useState } from "react";
import { ClipboardIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { parseThemeInput, type ParsedTheme } from "@themelab/shared";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ImportDialogProps {
  onImport: (parsed: ParsedTheme) => void;
}

export function ImportDialog({ onImport }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const load = () => {
    const parsed = parseThemeInput(text);
    if (!parsed) {
      toast.error("Couldn't parse that — paste the shadcn CSS or JSON export.");
      return;
    }
    const count = Object.keys(parsed.light).length + Object.keys(parsed.dark).length;
    onImport(parsed);
    toast.success(`Imported ${count} token${count === 1 ? "" : "s"}`);
    setText("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="ov-btn">
        <ClipboardIcon weight="bold" className="size-3.5" />
        Import
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="tl-overlay w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[42rem]"
        style={{ borderColor: "var(--ov-border)" }}
      >
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-[var(--ov-border)] p-4">
          <div className="text-left">
            <DialogTitle className="text-sm">Import theme</DialogTitle>
            <DialogDescription className="text-xs">
              Paste the shadcn CSS (<code>:root</code> + <code>.dark</code>) or the JSON export.
            </DialogDescription>
          </div>
          <DialogClose className="ov-btn px-2" aria-label="Close">
            <XIcon weight="bold" className="size-3.5" />
          </DialogClose>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={12}
            placeholder={":root {\n  --background: oklch(1 0 0);\n  ...\n}\n\n.dark {\n  ...\n}"}
            className="w-full resize-y rounded-[var(--ov-radius-sm)] border border-[var(--ov-border)] bg-[var(--ov-surface-2)] p-3 font-mono text-xs text-[var(--ov-text)] outline-none focus:border-[var(--ov-accent)]"
          />
          <div className="flex justify-end">
            <button type="button" className="ov-btn ov-btn-primary" onClick={load} disabled={!text.trim()}>
              Load theme
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
