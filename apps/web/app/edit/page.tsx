import type { Metadata } from "next";
import { ThemeEditor } from "@/components/theme-transpiler/theme-editor";

export const metadata: Metadata = {
  title: "Edit theme — ThemeLab",
  description:
    "Open a full shadcn theme, tweak its tokens with a live preview, and export the CSS or JSON.",
};

export default function EditPage() {
  return <ThemeEditor />;
}
