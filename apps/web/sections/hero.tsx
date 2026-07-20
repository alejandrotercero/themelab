import Link from "next/link"

import { CommandSnippet } from "@/components/command-snippet"
import type { Command } from "@/components/command-snippet"
import { buttonVariants } from "@/components/ui/button"
import type { ButtonProps } from "@/components/ui/button"

interface ImageProps {
  src: string
  alt?: string
}

type ButtonLink = ButtonProps & { url: string }

interface Props {
  heading: string
  description: string
  commands: Command[]
  buttons: ButtonLink[]
  image: ImageProps
}

export type HeaderProps = React.ComponentPropsWithoutRef<"section"> &
  Partial<Props>

export const HeaderDefaults: Props = {
  heading: "Long heading is what you see here in this header section",
  description:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique.",
  commands: [
    {
      label: "bash",
      code: "curl -fsSL https://themelab.dev/install.sh | bash",
    },
    { label: "npm", code: "npm install -g themelab-cli" },
    { label: "pnpm", code: "pnpm add -g themelab-cli" },
  ],
  image: {
    src: "https://r2.110696.xyz/placeholder.svg",
    alt: "Placeholder image",
  },
  buttons: [
    {
      title: "Button",
      url: "#",
    },
    {
      title: "Button",
      variant: "outline",
      url: "#",
    },
  ],
}

export const Header = (props: HeaderProps) => {
  const { heading, description, commands, buttons, image } = {
    ...HeaderDefaults,
    ...props,
  }
  return (
    <section className="bg-transparent px-[5%] py-10 md:py-16 lg:py-20">
      <div className="container">
        <div className="flex flex-col">
          <div className="mb-8 md:mb-18 lg:mb-10">
            <div className="w-full max-w-lg">
              <h1 className="mb-4 font-heading text-6xl tracking-tight md:mb-6 md:text-9xl lg:text-10xl">
                {heading}
              </h1>
              <p className="text-muted-foreground md:text-sm">{description}</p>
              <CommandSnippet
                commands={commands}
                className="mt-4 max-w-md md:mt-6"
              />
              <div className="mt-6 flex flex-wrap gap-4 md:mt-8">
                {buttons.map((button, index) => (
                  <Link
                    key={index}
                    href={button.url}
                    className={buttonVariants({
                      variant: button.variant,
                      size: button.size,
                    })}
                  >
                    {button.iconLeft && (
                      <span data-icon="inline-start">{button.iconLeft}</span>
                    )}
                    {button.title}
                    {button.iconRight && (
                      <span data-icon="inline-end">{button.iconRight}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div>
            <img
              src={image.src}
              className="ok wrap insidne size-full object-cover"
              alt={image.alt}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
