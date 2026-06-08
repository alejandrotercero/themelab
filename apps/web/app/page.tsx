import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Navbar2 } from "@/sections/landing-nav";
import { Header } from "@/sections/hero";
import { Features1 } from "@/sections/features1";
import { Footer } from "@/sections/footer";

export default function Page() {
  return (
    <main>
      <Navbar2 />
      <Header
        heading="Tools for building and translating design-token themes."
        buttons={[
          {
            title: "How it Works",
            url: "/",
            size: "lg"
          },
          {
            title: "Create a Theme",
            url: "/create",
            size: "lg",
            variant: "outline",
            children: ""
          }
        ]}
        image={{ src: "screen.png", alt: "ThemeLab screenshot" }}
      />
      <Features1
        cardsSmall={[
          {
            tagline: "cli native",
            heading: "CLi and MCP",
            description: "Use the CLI and MCP server to generate, transform, and apply themes directly from your terminal.",
            image: {
              src: "/type-vars.png",
              alt: "CLI",
            },
            button: {
              title: "Button",
              variant: "link",
              size: "link",
            },
          },
          {
            tagline: "cli native",
            heading: "CLi and MCP",
            description: "Use the CLI and MCP server to generate, transform, and apply themes directly from your terminal.",
            image: {
              src: "/theme.png",
              alt: "CLI",
            },
            button: {
              title: "Button",
              variant: "link",
              size: "link",
            },
          },
        ]}
        cardBig={{
          tagline: "Tagline",
          image: {
            src: "/term.png",
            alt: "Placeholder image 3",
          },
          heading: "Medium length section heading goes here",
          description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique. Duis cursus, mi quis viverra ornare, eros dolor interdum nulla, ut commodo diam libero vitae erat.",
          buttons: [
            { title: "Button", variant: "outline" },
            {
              title: "Button",
              variant: "link",
              size: "link",
            },
          ],
        }}
      />
      <Footer />
    </main>
  );
}
