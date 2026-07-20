import type { PropertyDescriptor } from "@themelab/shared";

import { PANEL, FONT_MONO } from "../../design-tokens.js";
import {
  classMatchesPrefix,
  findClassForVariant,
  decomposeClass,
} from "../../utils/class-matches-prefix.js";
import { getSnapPoints } from "../tailwind-resolver.js";
import { getVariantTokens } from "../variant-target.js";
import { createScaleShortcutButton } from "./scale-shortcut.js";
import type {
  PropertyControl,
  OnPreview,
  OnCommit,
  ControlContext,
} from "./types.js";

const VALID_KEYWORDS = new Set([
  "auto",
  "none",
  "normal",
  "inherit",
  "initial",
]);

/** Normalize a CSS length to pixels for tolerant comparison (rem/em ≈ ×16). */
function toPx(value: string): number | null {
  const n = Number(value);
  if (Number.isNaN(n)) {
    return null;
  }
  return /r?em\s*$/i.test(value.trim()) ? n * 16 : n;
}

export function createNumberScrub(
  descriptors: PropertyDescriptor[],
  values: Map<string, string>,
  onPreview: OnPreview,
  onCommit: OnCommit,
  ctx?: ControlContext
): PropertyControl {
  const [descriptor] = descriptors;
  const scaleName = descriptor.tailwindScale as Parameters<
    typeof getSnapPoints
  >[0];

  /**
   * The Tailwind token the element actually declares for this property at the
   * active variant — e.g. `lg` from `text-lg` (or `md:text-lg` when md is the
   * target). Reading the class is more reliable than reverse-resolving the
   * computed pixel value, since the scale is stored in rem (`text-lg` = 1.125rem)
   * and getComputedStyle returns px, so an exact value match usually fails.
   */
  function declaredToken(): string | null {
    const className = ctx?.selectedClassName;
    if (!className) {
      return null;
    }
    const classes = className.split(/\s+/).filter(Boolean);
    const pattern = descriptor.classPattern;
    const matchesBare = pattern
      ? (bare: string) => new RegExp(pattern).test(bare)
      : (bare: string) => classMatchesPrefix(bare, descriptor.tailwindPrefix);
    const cls = findClassForVariant(classes, matchesBare, getVariantTokens());
    if (!cls) {
      return null;
    }
    const { utility } = decomposeClass(cls);
    const lead = `${descriptor.tailwindPrefix}-`;
    return utility.startsWith(lead) ? utility.slice(lead.length) : null;
  }

  const container = document.createElement("div");
  container.style.cssText = `display:flex; align-items:center; gap:6px;`;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "prop-input";
  input.style.cssText = `flex:1; min-width:0; cursor:text;`;

  const tokenLabel = document.createElement("span");
  tokenLabel.style.cssText = `font-size:11px; color:${PANEL.accent}; font-family:${FONT_MONO}; white-space:nowrap; flex-shrink:0;`;

  container.append(input);
  // Font-size (and other scalable utilities) get a one-click scale picker beside the
  // token label; gated to fontSize for now per the spec.
  let scaleShortcut: { destroy: () => void } | null = null;
  if (descriptor.tailwindScale === "fontSize") {
    const shortcut = createScaleShortcutButton(descriptor, onPreview, onCommit);
    scaleShortcut = shortcut;
    container.append(shortcut.button);
  }
  container.append(tokenLabel);

  // State
  const currentValues = new Map(values);

  function getCurrentCssValue(): string {
    return currentValues.get(descriptor.key) ?? descriptor.defaultValue;
  }

  function updateDisplay(cssValue: string): void {
    const num = Number(cssValue);
    input.value = Number.isNaN(num) ? cssValue : String(num);

    try {
      const snapPoints = getSnapPoints(scaleName, cssValue);

      // 1. Prefer the token the element literally declares (e.g. `text-lg`), as
      //    long as the value we're showing still matches it — so a live edit that
      //    moves off the declared size falls through to the reverse lookup below.
      const declared = declaredToken();
      if (declared) {
        const declaredCss = snapPoints.find(
          (p) => p.token === declared
        )?.cssValue;
        const cur = toPx(cssValue);
        const dec = declaredCss === undefined ? null : toPx(declaredCss);
        const matches =
          declaredCss === undefined ||
          cur === null ||
          dec === null ||
          Math.abs(cur - dec) < 0.5;
        if (matches) {
          tokenLabel.textContent = `${descriptor.tailwindPrefix}-${declared}`;
          return;
        }
      }

      // 2. Reverse-resolve the current value to a scale token. Match by exact
      //    string first, else by pixel value (the scale is rem, computed is px).
      const cur = toPx(cssValue);
      const byPx = (p: { token: string | null; cssValue: string }): boolean => {
        if (p.token === null || cur === null) {
          return false;
        }
        const v = toPx(p.cssValue);
        return v !== null && Math.abs(v - cur) < 0.5;
      };
      const match =
        snapPoints.find((p) => p.cssValue === cssValue) ??
        snapPoints.find(byPx);
      tokenLabel.textContent = match?.token
        ? `${descriptor.tailwindPrefix}-${match.token}`
        : "";
    } catch {
      tokenLabel.textContent = "";
    }
  }

  // Text input editing — commit on blur
  input.addEventListener("blur", () => {
    const raw = input.value.trim();
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      const unitMatch = raw.match(/(?<unit>px|rem|em|%|vw|vh|ch)$/);
      const cssValue = unitMatch ? raw : `${num}px`;
      currentValues.set(descriptor.key, cssValue);
      updateDisplay(cssValue);
      onPreview(descriptor.key, cssValue);
      onCommit();
    } else if (VALID_KEYWORDS.has(raw)) {
      currentValues.set(descriptor.key, raw);
      updateDisplay(raw);
      onPreview(descriptor.key, raw);
      onCommit();
    } else {
      // Revert
      updateDisplay(getCurrentCssValue());
    }
  });

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      input.blur();
    } else if (e.key === "Escape") {
      updateDisplay(getCurrentCssValue());
      input.blur();
    }
  });

  // Init
  updateDisplay(getCurrentCssValue());

  return {
    element: container,
    setValue(key: string, cssValue: string): void {
      if (key !== descriptor.key) {
        return;
      }
      currentValues.set(key, cssValue);
      updateDisplay(cssValue);
    },
    destroy(): void {
      scaleShortcut?.destroy();
      // No document-level listeners
    },
  };
}
