import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

type ImageProps = {
  src: string;
  alt?: string;
};

type CardBaseProps = {
  tagline?: string;
  image: ImageProps;
  heading: string;
  description: string;
};

type CardsSmallProps = CardBaseProps & {
  button?: ButtonProps;
};

type CardBigProps = CardBaseProps & {
  buttons?: ButtonProps[];
};

type Props = {
  tagline?: string;
  heading: string;
  description: string;
  cardsSmall: CardsSmallProps[];
  cardBig: CardBigProps;
};

export type Features1Props = React.ComponentPropsWithoutRef<"section"> & Partial<Props>;

// Normalize either card shape (cardBig has `buttons`, cardsSmall has `button`)
// into a single button list so every card renders uniformly.
function cardButtons(card: CardBigProps | CardsSmallProps): ButtonProps[] {
  if ("buttons" in card && card.buttons) return card.buttons;
  if ("button" in card && card.button) return [card.button];
  return [];
}

export const Features1 = (props: Features1Props) => {
  const { tagline, heading, description, cardsSmall, cardBig } = {
    ...Features1Defaults,
    ...props,
  };
  return (
    <section className="px-[5%] py-8 md:py-12 lg:py-14 bg-transparent" >
      <div className="mx-auto w-full ">
        <div className="mb-12 md:mb-18 lg:mb-20">
          <div className="mx-auto max-w-lg text-center">
            {tagline && <p className="mb-3 text-xl uppercase bg-background/50 text-primary md:mb-4 font-heading tracking-wider">{tagline}</p>}
            <h2 className="mb-5 text-6xl font-heading md:mb-6 md:text-8xl lg:text-9xl tracking-tight">
              {heading}
            </h2>
            <p className="md:text-md ">{description}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[cardBig, ...cardsSmall].map((card, index) => {
            const buttons = cardButtons(card);
            return (
              <div
                key={index}
                className="flex flex-col overflow-hidden rounded-2xl border border-border-primary bg-card dark:bg-background"
              >
                <img
                  src={card.image.src}
                  alt={card.image.alt}
                  className="w-full h-auto object-contain border-b border-border-primary"
                />
                <div className="flex flex-1 flex-col p-4 md:p-6">
                  {card.tagline && <p className="mb-2 text-xs uppercase text-muted-foreground font-heading tracking-wider">{card.tagline}</p>}
                  <h3 className="mb-2 text-lg md:text-2xl font-heading leading-[1.12]">{card.heading}</h3>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                  {buttons.length > 0 && (
                    <div className="mt-4 flex items-center gap-4">
                      {buttons.map((button, i) => (
                        <Button key={i} variant={button.variant} size={button.size}>{button.iconLeft && <span data-icon="inline-start">{button.iconLeft}</span>}{button.title}{button.iconRight && <span data-icon="inline-end">{button.iconRight}</span>}</Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const Features1Defaults: Props = {
  tagline:"Tagline",
  heading:"Short heading goes here",
  description:"Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  cardsSmall: [
    {
      tagline:"Tagline",
      image: {
        src:"https://r2.110696.xyz/placeholder.svg",
        alt:"Placeholder image 1",
      },
      heading:"Medium length section heading goes here",
      description:
"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique.",
      button: {
        title:"Button",
        variant:"link",
        size:"link",
        iconRight: <CaretRightIcon/>,
      },
    },
    {
      tagline:"Tagline",
      image: {
        src:"https://r2.110696.xyz/placeholder.svg",
        alt:"Placeholder image 2",
      },
      heading:"Medium length section heading goes here",
      description:
"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique.",
      button: {
        title:"Button",
        variant:"link",
        size:"link",
        iconRight: <CaretRightIcon/>,
      },
    },
  ],
  cardBig: {
    tagline:"Tagline",
    image: {
      src:"https://r2.110696.xyz/placeholder.svg",
      alt:"Placeholder image 3",
    },
    heading:"Medium length section heading goes here",
    description:
"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique. Duis cursus, mi quis viverra ornare, eros dolor interdum nulla, ut commodo diam libero vitae erat.",
    buttons: [
      { title:"Button", variant:"outline" },
      {
        title:"Button",
        variant:"link",
        size:"link",
        iconRight: <CaretRightIcon/>,
      },
    ],
  },
};
