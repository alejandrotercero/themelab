"use client"

// /library — standalone gallery of saved themes. Opening a theme routes into the
// editor (/edit?saved=<id>) so it can be tweaked and re-saved in place. Wears the
// studio's overlay skin to match the tools.

import Link from "next/link"
import { useRouter } from "next/navigation"

import { LibraryGallery } from "@/components/library/library-gallery"
import { Logo } from "@/components/logo"
import { Toaster } from "@/components/ui/sonner"

export default function LibraryPage() {
  const router = useRouter()

  return (
    <div className="tl-overlay flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--ov-border)] px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-[var(--ov-text)]">
          <Link
            href="/"
            aria-label="ThemeLab home"
            className="flex items-center"
          >
            <Logo className="h-3.5" />
          </Link>
          <span className="text-[var(--ov-text-ghost)]">/</span>
          <h1 className="text-sm font-semibold tracking-tight">library</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/create" className="ov-btn">
            New theme
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full flex-1 px-4 py-6">
        <LibraryGallery onOpen={(t) => router.push(`/edit?saved=${t.id}`)} />
      </main>

      <Toaster />
    </div>
  )
}
