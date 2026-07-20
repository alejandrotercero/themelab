import type { Metadata } from "next"

import { MindfulCreator } from "@/components/theme-transpiler/mindful-creator"

export const metadata: Metadata = {
  title: "Mindful Palette → shadcn theme generator",
  description:
    "Turn a 6-color Mindful Palette (2 light · 2 accent · 2 dark) into a full shadcn/Tailwind theme, with a live editor and preview. Inspired by the #MindfulPalettes format by Alex Cristache.",
}

export default function MindfulPalettesPage() {
  return <MindfulCreator />
}
