import Link from "next/link";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Navbar2 } from "@/sections/landing-nav";
import { Footer } from "@/sections/footer";
import { CommandSnippet } from "@/components/command-snippet";
import DotBackground from "@/components/dot-background";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "How it works — ThemeLab",
  description:
    "ThemeLab proxies your local dev server and injects a visual overlay. Click any element, edit its Tailwind classes or theme tokens, and confirmed changes are written back to your source files by deterministic AST transforms.",
};

const NAV_LINKS = [
  { title: "Theme Generator", url: "/create" },
  { title: "100r Themes", url: "/100r" },
  { title: "Github", url: "https://github.com/alejandrotercero/themelab" },
];

const INSTALL_COMMANDS = [
  { label: "bash", code: "curl -fsSL https://themelab.dev/install.sh | bash" },
  { label: "npm", code: "npm install -g themelab-cli" },
  { label: "pnpm", code: "pnpm add -g themelab-cli" },
];

const STEPS = [
  {
    title: "Run it next to your dev server",
    body: "Start your React app as usual, then run themelab in a second terminal from the same project root. It opens a local reverse proxy in front of your dev server and injects a small overlay into the page — your app's source is never modified, and the overlay lives in its own Shadow DOM so its styles can't leak into (or inherit from) your UI. Auto-detection finds your dev port; pass it explicitly if needed.",
  },
  {
    title: "Click to select any element",
    body: "Hover and click an element on your running app. ThemeLab walks the React Fiber tree (via getOwnerStack on React 19, with a fiber-walk fallback on React 18) to resolve exactly which component rendered it — its name, the source file, and the line number. You can also move through the hierarchy — parent, child, siblings — from the keyboard or the sidebar.",
  },
  {
    title: "Edit visually",
    body: "Change Tailwind classes from grouped controls — Layout, Spacing, Size, Typography, Background, and Border — including DevTools-style flex alignment, a text-case toggle, and radius/width/color/style. Pick colors from the full Tailwind v4 palette or bind a property to a theme variable. Edit your shadcn/Tailwind theme tokens (the CSS variables in :root and .dark) with live preview and a light/dark toggle. Double-click text to rewrite it inline; copy, paste, duplicate, delete, and reorder siblings.",
  },
  {
    title: "Confirm — changes write to source",
    body: "Stage as many edits as you like, then hit Confirm. Each change is applied by a deterministic jscodeshift AST transform that edits your actual source files in place — not a screenshot, not a diff to copy. The browser updates immediately. Reordering an item rendered by a .map() reorders the matching entry in the underlying data array, not the JSX.",
  },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-heading tracking-tight md:text-3xl">
        {title}
      </h2>
      <div className="space-y-3 text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <DotBackground className="min-h-svh">
    <main className="min-h-svh ">
      <Navbar2 navLinks={NAV_LINKS} />

      <article className="mx-auto w-full max-w-3xl px-[5%] py-16 md:py-24 container">
        <Logo className="max-w-1/2 mx-auto mb-4"/>
        <header className="mb-12 md:mb-16">
          <p className="mb-3 text-sm uppercase tracking-wider text-primary font-heading">
            How it works
          </p>
          <h1 className="text-4xl font-heading tracking-tight md:text-6xl">
            Your running app is the editor.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
            ThemeLab is a local command-line tool. It sits in front of the dev
            server you already run and gives you a visual editing layer on top of
            your real app — every change you confirm is written straight back into
            your source files. No prompts to write, no files to hunt through, and
            no AI in the loop unless you ask for it.
          </p>
        </header>

        <div className="space-y-12 md:space-y-16">
          <Section title="The core idea">
            <p>
              Most ways of changing a UI ask you to leave the thing you are
              looking at: switch to the editor, find the right file, find the
              right line, make the edit, switch back, wait for reload. ThemeLab
              collapses that loop. Because it proxies your dev server and injects
              an overlay, the page in your browser is your app — but now every
              element is selectable and editable. What you see is literally what
              you are editing.
            </p>
            <p>
              Nothing about your project changes to make this work. There is no
              plugin to add to your bundler, no provider to wrap your app in, and
              no build step. ThemeLab reads the React tree at runtime to map
              pixels back to components, and writes edits back as ordinary code
              changes you can review in git like any other diff.
            </p>
          </Section>

          <Section title="The loop, step by step">
            <ol className="space-y-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border font-heading text-sm text-foreground"
                  >
                    {i + 1}
                  </span>
                  <div className="space-y-2">
                    <h3 className="font-heading text-lg text-foreground">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Deterministic by default">
            <p>
              Every edit ThemeLab applies is a precise, rule-based transform of
              your code — the same input always produces the same output. That
              means changes are predictable and reviewable: a class added here, a
              token updated there, a node moved in a list. There is no model
              guessing what you meant and no risk of an edit quietly rewriting
              code you did not touch.
            </p>
          </Section>

          <Section title="AI assist — optional, and only a locator">
            <p>
              A few cases are genuinely ambiguous in source: an element rendered
              by a .map(), a reused component instance, conditional or
              state-dependent rendering, or a component that outputs a different
              host tag than its name suggests (a Link that renders an a). For
              those, you can turn on an AI locator. It reads your source to find
              the exact node to edit — and then hands control back. The change
              itself is still applied by the same deterministic AST transform. The
              AI only locates; it never writes your code.
            </p>
            <p>
              It is off by default and runs only when you configure an
              ANTHROPIC_API_KEY. When an edit would affect more than the selected
              element — a .map() template or a shared component — it asks you to
              confirm first, and it caches what it finds so repeated tweaks stay
              instant. If it truly cannot find the element, it tells you why
              rather than guessing.
            </p>
          </Section>

          <Section title="It talks to your coding agent too">
            <p>
              While ThemeLab is running it also exposes a small MCP server on
              localhost, so a coding agent like Claude Code or Cursor can read
              what you are doing in the overlay. Click a component in the browser
              and your agent knows the exact file and line — no more "which Button
              did you mean?". It can ask for the current selection, the resolved
              theme tokens, the Tailwind token map, or where a component lives in
              the source.
            </p>
          </Section>

          <Section title="What you need">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Node.js 20+ and a React project (18+)</li>
              <li>A running development server</li>
              <li>Next.js, Vite, or Create React App</li>
              <li>
                Tailwind CSS is recommended for the property editor; text and
                structural edits work without it.
              </li>
            </ul>
          </Section>
        </div>

        <div className="mt-14 space-y-5 border-t border-border pt-10 md:mt-20">
          <h2 className="text-2xl font-heading tracking-tight md:text-3xl">
            Install and start editing
          </h2>
          <CommandSnippet commands={INSTALL_COMMANDS} className="max-w-md" />
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/create" className={buttonVariants({ size: "lg" })}>
              Create a theme
            </Link>
            <Link
              href="/"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              Back home
            </Link>
          </div>
        </div>
      </article>

      <Footer />

    </main>
    </DotBackground>
  );
}
