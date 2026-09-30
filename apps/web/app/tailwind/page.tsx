import type { Metadata } from "next"

import { TailwindCreator } from "@/components/theme-transpiler/tailwind-creator"

export const metadata: Metadata = {
  title: "Build Tailwind color scales from a single color",
  description:
    "Turn any color into a full Tailwind 50–950 scale (or Radix 1–12) with a live preview, Tailwind @theme export, and copy-as-SVG for Figma.",
}

export default function TailwindPage() {
  return <TailwindCreator />
}
