import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-medium tracking-tight text-balance">ThemeLab</h1>
        <p className="text-muted-foreground text-balance">
          Tools for building and translating design-token themes.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/create">
          <Button size="lg">
            Create a theme
            <ArrowRightIcon weight="bold" />
          </Button>
        </Link>
        <Link href="/100r">
          <Button size="lg" variant="outline">
            100r → shadcn
            <ArrowRightIcon weight="bold" />
          </Button>
        </Link>
      </div>
    </main>
  );
}
