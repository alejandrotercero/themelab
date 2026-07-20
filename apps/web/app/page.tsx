import Link from "next/link"

import { CommandSnippet } from "@/components/command-snippet"
import DotBackground from "@/components/dot-background"
import { Logo } from "@/components/logo"
import { buttonVariants } from "@/components/ui/button"
import { Features1 } from "@/sections/features1"
import { Footer } from "@/sections/footer"
import { Header } from "@/sections/hero"
import { Navbar2 } from "@/sections/landing-nav"

export default function Page() {
  return (
    <DotBackground className="min-h-svh">
      <main>
        <Navbar2
          navLinks={[
            { title: "Theme Generator", url: "/create" },
            { title: "100r Themes", url: "/100r" },
            { title: "Mindful Palettes", url: "/mindfulpalettes" },
            { title: "Library", url: "/library" },
            {
              title: "Github",
              url: "https://github.com/alejandrotercero/themelab",
            },
          ]}
        />
        <Header
          heading="Edit your UI directly. No prompts, no file hunting."
          description="ThemeLab is a local CLI browser overlay for your dev server. Click any element, edit its Tailwind classes or shadcn/ui theme variables, and changes write to source instantly. Faster than describing it. Cheaper than asking an agent."
          buttons={[
            {
              title: "How it Works",
              url: "/how-it-works",
              size: "lg",
            },
            {
              title: "Create a Theme",
              url: "/create",
              size: "lg",
              variant: "outline",
            },
          ]}
          image={{ src: "screen.png", alt: "ThemeLab screenshot" }}
        />
        <Features1
          tagline="Polishing a UI in code has always been slower than it should be."
          heading="ThemeLab cuts the loop. Your app is the editor."
          description=""
          cardsSmall={[
            {
              heading: "Theme editing in real time",
              description:
                "Adjust shadcn/ui theme variables and see the cascade across your entire page as you go. Color, radius, spacing, dark mode — all live.",
              image: {
                src: "/type-vars.jpg",
                alt: "Theme Editor",
              },
            },
            {
              heading: "AI as fallback, not the interface",
              description:
                "When the engine can't resolve a source location, AI steps in, finds it, and hands back control. You never notice it — which is the point.",
              image: {
                src: "/ai.jpg",
                alt: "AI UI",
              },
            },
          ]}
          cardBig={{
            image: {
              src: "/manipulation.jpg",
              alt: "Direct manipulation UI",
            },
            heading: "Direct manipulation",
            description:
              "Click any element on your running app and edit its Tailwind classes in a panel. Changes write to source immediately — no switching contexts, no reloading.",
            buttons: [],
          }}
        />
        <section className="px-[5%] py-8 md:py-12 lg:py-14">
          <div className="container">
            <div className="grid grid-cols-1 gap-y-12 md:grid-cols-2 md:items-center md:gap-x-12 lg:gap-x-20">
              <div>
                <img
                  src="/themes.png"
                  className="w-full rounded-2xl border border-border object-cover shadow-md shadow-black dark:shadow-primary"
                  alt="Theme Editor"
                />
              </div>
              <div>
                <h1 className="mb-5 font-heading text-4xl md:mb-6 md:text-6xl lg:text-8xl">
                  Generate a theme.
                  <br />
                  <span className="text-primary">Apply it live.</span>
                </h1>
                <p className="text-muted-foreground md:text-sm">
                  ThemeLab.dev includes a web-based theme creator — build a full
                  shadcn/ui theme from scratch, then open it directly from the
                  overlay and paste it into your project. Design the theme, see
                  it on your actual app, ship it. No config file guessing.
                </p>
                <Link
                  href="/create"
                  className={buttonVariants({ className: "mt-3" })}
                >
                  Create a Theme
                </Link>
              </div>
            </div>
          </div>
        </section>
        <section className="border-t border-b bg-background px-[5%] py-16 md:py-24 lg:py-28">
          <div className="container">
            <div className="grid grid-cols-1 items-start justify-between gap-5 md:grid-cols-2 md:gap-x-12 md:gap-y-8 lg:gap-x-20 lg:gap-y-16">
              <div>
                <h3 className="font-heading text-4xl leading-[1.2] md:text-6xl lg:text-7xl">
                  Who It&apos;s For
                </h3>
                <p className="py-4 font-heading text-xl text-primary">
                  If you&apos;ve ever asked a coding agent to move something 4px
                  and waited 30 seconds for it, this is for you.
                </p>
                <p className="mb-5 text-sm text-muted-foreground md:mb-6">
                  For designers using AI who want fast UI edits. For design
                  engineers who work in code like others work in Figma. For
                  frontend devs who know what needs to change and just want to
                  change it.
                </p>
              </div>
              <div>
                <div className="grid grid-cols-1 gap-4 py-2">
                  <h3 className="font-heading text-4xl leading-[1.2] md:text-6xl lg:text-7xl">
                    How It Works
                  </h3>

                  <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                    <li>
                      Install ThemeLab and run it alongside your dev server
                    </li>
                    <li>
                      Click any element on your app to open the edit panel
                    </li>
                    <li>
                      Edit classes, theme variables, text, or layout directly
                    </li>
                    <li>
                      Changes write to source. Browser updates immediately.
                    </li>
                    <li>
                      Open the theme creator on ThemeLab.dev to build or import
                      a full theme
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="relative bg-primary px-[5%] py-16 text-primary-foreground md:py-24 lg:py-28">
          <div className="container grid grid-rows-1 items-start gap-y-5 md:grid-cols-2 md:gap-x-12 md:gap-y-8 lg:gap-x-20 lg:gap-y-16">
            <div>
              <Logo className="w-full pr-2 text-primary-foreground/20" />
              <h1 className="py-2 font-heading text-4xl text-foreground md:text-5xl lg:text-6xl dark:text-background">
                Your app is the canvas.
              </h1>
            </div>
            <div>
              <p className="font-heading text-2xl text-background dark:text-foreground">
                Install ThemeLab and start editing.
              </p>

              <CommandSnippet
                commands={[
                  {
                    label: "bash",
                    code: "curl -fsSL https://themelab.dev/install.sh | bash",
                  },
                  { label: "npm", code: "npm install -g themelab-cli" },
                  { label: "pnpm", code: "pnpm add -g themelab-cli" },
                ]}
                className="mt-4 max-w-md"
              />
            </div>
          </div>
        </section>
        <Footer />
      </main>
    </DotBackground>
  )
}
