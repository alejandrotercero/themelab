// HR (Hundred Rabbits) theme model + analysis types for the transpiler.
// See /Volumes/SSD/Downloads/100r.md for the architecture this implements.

/** The 9 canonical Hundred Rabbits theme slots (SVG element ids). */
export type HrSlot =
  | "background"
  | "f_high"
  | "f_med"
  | "f_low"
  | "f_inv"
  | "b_high"
  | "b_med"
  | "b_low"
  | "b_inv";

export const HR_SLOTS: readonly HrSlot[] = [
  "background",
  "f_high",
  "f_med",
  "f_low",
  "f_inv",
  "b_high",
  "b_med",
  "b_low",
  "b_inv",
] as const;

/** A parsed Hundred Rabbits theme. Slots are hex strings; some may be absent. */
export interface HrTheme {
  slots: Partial<Record<HrSlot, string>>;
  /** Author from an SVG comment, if present. */
  author?: string;
  /** Extra `tape_*` desc colors some themes carry (not used for the core 9). */
  tape: Record<string, string>;
}

/** Which mode the HR theme natively encodes (the other is synthesized). */
export type NativeMode = "dark" | "light";

/** Result of the luminance hard-gate from the transcript. */
export type Verdict = "pass" | "partial" | "fail";

export interface LuminanceLevel {
  slot: HrSlot;
  hex: string;
  /** Perceptual lightness, OKLCH L × 100 (0–100). */
  lStar: number;
}

export interface LuminanceReport {
  /** Present slots with their L*, sorted dark → light. */
  levels: LuminanceLevel[];
  /** Count of distinct L* values (rounded to 1 decimal). */
  uniqueCount: number;
  min: number;
  max: number;
  range: number;
  nativeMode: NativeMode;
  verdict: Verdict;
  /** 0–100 quality estimate (how rich a shadcn theme this can seed). */
  score: number;
  notes: string[];
}
