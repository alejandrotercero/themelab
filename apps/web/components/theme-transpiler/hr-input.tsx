"use client";

// HR theme input, compact for the bottom boom bar: a drop target, a preset
// picker, and a paste toggle. All three resolve to a parsed HrTheme.

import { useState } from "react";
import { UploadSimpleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseHrSvg, PRESETS, type HrTheme } from "@/lib/theme-engine";

interface HrInputProps {
  onLoad: (theme: HrTheme, sourceName: string) => void;
  onError: (message: string) => void;
}

export function HrInput({ onLoad, onError }: HrInputProps) {
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");

  const handleSvg = (svg: string, name: string) => {
    try {
      onLoad(parseHrSvg(svg), name);
      setPasteOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to parse theme.");
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    handleSvg(await file.text(), file.name.replace(/\.svg$/i, ""));
  };

  const loadPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) handleSvg(preset.svg, preset.name);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-1 items-center gap-2 rounded-[var(--ov-radius-sm)] border border-dashed border-[var(--ov-border)] px-3 py-2 transition-colors",
            dragging && "border-[var(--ov-accent)] bg-[var(--ov-accent-soft)]",
          )}
        >
          <UploadSimpleIcon weight="bold" className="size-4 text-[var(--ov-text-dim)]" />
          <span className="text-xs text-[var(--ov-text-dim)]">Drop a Hundred Rabbits .svg</span>
        </div>

        <Select onValueChange={(v) => v && loadPreset(String(v))}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder="Preset…" />
          </SelectTrigger>
          <SelectContent
            className="tl-overlay w-auto max-w-[min(90vw,26rem)] min-w-(--anchor-width)"
            alignItemWithTrigger={false}
          >
            {PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-[var(--ov-text-dim)]">{p.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button type="button" className="ov-btn" onClick={() => setPasteOpen((v) => !v)}>
          Paste
        </button>
      </div>

      {pasteOpen && (
        <div className="flex items-start gap-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="<svg …> id='background', 'f_high', 'b_inv'… </svg>"
            spellCheck={false}
            className="ov-input h-16 min-w-0 flex-1 resize-none font-mono"
          />
          <button
            type="button"
            className="ov-btn ov-btn-primary"
            disabled={!pasted.trim()}
            onClick={() => handleSvg(pasted, "Pasted theme")}
          >
            Transpile
          </button>
        </div>
      )}
    </div>
  );
}
