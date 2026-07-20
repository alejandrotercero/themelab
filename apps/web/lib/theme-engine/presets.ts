// Bundled Hundred Rabbits themes as SVG strings, so the preset picker exercises
// the same parse path as a dropped file. apollo / ablaze / aeriform come from
// the 100r.md analysis; marble is a light-native theme to demo the light path.

import type { HrSlot } from "./types"

type SlotMap = Record<HrSlot, string>

function toSvg(author: string, s: SlotMap): string {
  return `<svg width='96px' height='64px' xmlns='http://www.w3.org/2000/svg' baseProfile='full' version='1.1'>
  <!-- Author: ${author} -->
  <rect width='96' height='64' id='background' fill='${s.background}'></rect>
  <circle cx='24' cy='24' r='8' id='f_high' fill='${s.f_high}'></circle>
  <circle cx='40' cy='24' r='8' id='f_med'  fill='${s.f_med}'></circle>
  <circle cx='56' cy='24' r='8' id='f_low'  fill='${s.f_low}'></circle>
  <circle cx='72' cy='24' r='8' id='f_inv'  fill='${s.f_inv}'></circle>
  <circle cx='24' cy='40' r='8' id='b_high' fill='${s.b_high}'></circle>
  <circle cx='40' cy='40' r='8' id='b_med'  fill='${s.b_med}'></circle>
  <circle cx='56' cy='40' r='8' id='b_low'  fill='${s.b_low}'></circle>
  <circle cx='72' cy='40' r='8' id='b_inv'  fill='${s.b_inv}'></circle>
</svg>`
}

export interface Preset {
  id: string
  name: string
  /** Short note shown in the picker. */
  hint: string
  svg: string
}

export const PRESETS: Preset[] = [
  {
    id: "apollo",
    name: "Apollo",
    hint: "Rich dark — passes cleanly (7 levels)",
    svg: toSvg("Hundred Rabbits", {
      background: "#0a0a0a",
      f_high: "#ececec",
      f_med: "#a0a0a0",
      f_low: "#505050",
      f_inv: "#ececec",
      b_high: "#1a1a1a",
      b_med: "#2a2a2a",
      b_low: "#1a1a1a",
      b_inv: "#cc665f",
    }),
  },
  {
    id: "ablaze",
    name: "Ablaze",
    hint: "Coral dark — the tested theme (8 levels)",
    svg: toSvg("Ablaze", {
      background: "#111111",
      f_high: "#ffffff",
      f_med: "#aaaaaa",
      f_low: "#555555",
      f_inv: "#000000",
      b_high: "#fc533e",
      b_med: "#666666",
      b_low: "#333333",
      b_inv: "#fc533e",
    }),
  },
  {
    id: "marble",
    name: "Marble",
    hint: "Light-native — demos the light path",
    svg: toSvg("Marble", {
      background: "#f4f1ea",
      f_high: "#16130d",
      f_med: "#4a463c",
      f_low: "#8c8678",
      f_inv: "#f4f1ea",
      b_high: "#d8d2c4",
      b_med: "#c3bcab",
      b_low: "#e9e5db",
      b_inv: "#3d6e8e",
    }),
  },
  {
    id: "aeriform",
    name: "Aeriform",
    hint: "Sparse — fails the gate (teaching example)",
    svg: toSvg("Aeriform", {
      background: "#171410",
      f_high: "#cabcc2",
      f_med: "#26211b",
      f_low: "#171410",
      f_inv: "#cabcc2",
      b_high: "#171410",
      b_med: "#26211b",
      b_low: "#171410",
      b_inv: "#cc665f",
    }),
  },
]
