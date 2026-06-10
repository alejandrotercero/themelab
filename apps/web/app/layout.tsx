import { Google_Sans_Code, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Analytics } from "@vercel/analytics/next";

// Matches the ThemeLab overlay, which renders entirely in Google Sans Code for
// its code-tool aesthetic (packages/overlay/src/design-tokens.ts → FONT_FAMILY).
// Variable font (300–800) self-hosted by next/font; globals.css maps both
// --font-sans and --font-mono onto it so the whole app inherits it.
const googleSansCode = Google_Sans_Code({
  subsets: ["latin"],
  variable: "--font-google-sans-code",
  fallback: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
})

// Inter is exposed only as a variable; the theme-transpiler preview opts into it
// so previewed components look like a normal app rather than the mono chrome.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", googleSansCode.variable, inter.variable, "font-sans")}
    >
      <head>
        {/* Geomanist — exposed via the `font-heading` utility (globals.css); not applied anywhere yet. */}
        <link rel="stylesheet" href="https://cdn.nonx.dev/fonts/geomanist.full.css" />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
