import type { Metadata } from "next";
import { ThemeCreator } from "@/components/theme-transpiler/theme-creator";

export const metadata: Metadata = {
  title: "Create a shadcn theme from a palette",
  description:
    "Pick a primary and neutral color and generate Tailwind 50–950 scales plus a full shadcn theme, with a live editor and preview.",
};

export default function CreatePage() {
  return <ThemeCreator />;
}
