import type { Metadata } from "next"

import { ThemeTranspiler } from "@/components/theme-transpiler/theme-transpiler"

export const metadata: Metadata = {
  title: "100r → shadcn theme transpiler",
  description:
    "Turn a 9-color Hundred Rabbits theme into a full shadcn/Tailwind theme, with a live editor and preview.",
}

export default function ThemeTranspilerPage() {
  return <ThemeTranspiler />
}
