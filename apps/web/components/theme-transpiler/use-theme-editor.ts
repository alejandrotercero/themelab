"use client";

// Shared editor state for both tools (/100r transpiler and /create). Manages the
// generated base theme, per-mode manual overrides, active mode, radius, and the
// "apply to page" toggle — plus the root ref and the effect that re-skins the
// whole chrome when "apply to page" is on. Each tool feeds it a `base` via
// loadBase() and renders its own input/output panels around it.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ThemeStyles } from "@themelab/shared";
import { THEME_TOKENS } from "@/lib/theme-engine";
import { applyVars, clearVars, OV_SKIN_KEYS, ovSkinVars } from "./apply-vars";

export type Mode = "light" | "dark";
export interface Swatch {
  slot: string;
  hex: string;
}
type Overrides = { light: Record<string, string>; dark: Record<string, string> };

interface State {
  source: string;
  base: ThemeStyles | null;
  swatches: Swatch[];
  overrides: Overrides;
  mode: Mode;
  radius: string;
  // id of the saved-library entry this theme came from (null when freshly
  // generated/imported) — drives "update in place" on Save.
  savedId: string | null;
}

type Action =
  | { type: "base"; base: ThemeStyles; source: string; swatches: Swatch[]; mode?: Mode; savedId?: string | null }
  | { type: "swatches"; swatches: Swatch[] }
  | { type: "token"; token: string; value: string }
  | { type: "mode"; mode: Mode }
  | { type: "radius"; value: string }
  | { type: "savedId"; savedId: string | null };

const initialState: State = {
  source: "",
  base: null,
  swatches: [],
  overrides: { light: {}, dark: {} },
  mode: "dark",
  radius: "0.625rem",
  savedId: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "base":
      return {
        ...state,
        source: action.source,
        base: action.base,
        swatches: action.swatches,
        overrides: { light: {}, dark: {} },
        mode: action.mode ?? state.mode,
        // Generating/importing detaches from any open saved entry unless the
        // caller explicitly carries one (e.g. opening from the library).
        savedId: action.savedId ?? null,
      };
    case "swatches":
      return { ...state, swatches: action.swatches };
    case "token":
      return {
        ...state,
        overrides: {
          ...state.overrides,
          [state.mode]: { ...state.overrides[state.mode], [action.token]: action.value },
        },
      };
    case "mode":
      return { ...state, mode: action.mode };
    case "radius":
      return { ...state, radius: action.value };
    case "savedId":
      return { ...state, savedId: action.savedId };
    default:
      return state;
  }
}

function resolve(base: ThemeStyles | null, overrides: Overrides): ThemeStyles {
  if (!base) return { light: {}, dark: {} };
  return {
    light: { ...base.light, ...overrides.light },
    dark: { ...base.dark, ...overrides.dark },
  };
}

export function useThemeEditor() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [applyToSite, setApplyToSite] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const theme = useMemo(() => resolve(state.base, state.overrides), [state.base, state.overrides]);
  const activeVars = state.mode === "dark" ? theme.dark : theme.light;
  const edited = useMemo(
    () => new Set(Object.keys(state.overrides[state.mode])),
    [state.overrides, state.mode],
  );

  // "Apply to page": write the shadcn tokens + overlay-skin vars onto the root.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !applyToSite) return;
    applyVars(root, { ...activeVars, ...ovSkinVars(activeVars) }, { dark: state.mode === "dark", radius: state.radius });
    return () => clearVars(root, [...THEME_TOKENS, ...OV_SKIN_KEYS]);
  }, [applyToSite, activeVars, state.mode, state.radius]);

  return {
    rootRef,
    mode: state.mode,
    radius: state.radius,
    source: state.source,
    swatches: state.swatches,
    savedId: state.savedId,
    applyToSite,
    theme,
    activeVars,
    edited,
    loadBase: (
      base: ThemeStyles,
      opts: { source: string; swatches: Swatch[]; mode?: Mode; savedId?: string | null },
    ) =>
      dispatch({
        type: "base",
        base,
        source: opts.source,
        swatches: opts.swatches,
        mode: opts.mode,
        savedId: opts.savedId,
      }),
    setMode: (mode: Mode) => dispatch({ type: "mode", mode }),
    setRadius: (value: string) => dispatch({ type: "radius", value }),
    setToken: (token: string, value: string) => dispatch({ type: "token", token, value }),
    setSwatches: (swatches: Swatch[]) => dispatch({ type: "swatches", swatches }),
    setSavedId: (savedId: string | null) => dispatch({ type: "savedId", savedId }),
    setApplyToSite,
  };
}
