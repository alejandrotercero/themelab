import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

type ImageProps = {
  src: string;
  alt?: string;
};

type CardBaseProps = {
  tagline: string;
  image: ImageProps;
  heading: string;
  description: string;
};

type CardsSmallProps = CardBaseProps & {
  button: ButtonProps;
};

type CardBigProps = CardBaseProps & {
  buttons: ButtonProps[];
};

type Props = {
  tagline: string;
  heading: string;
  description: string;
  cardsSmall: CardsSmallProps[];
  cardBig: CardBigProps;
};

export type Features1Props = React.ComponentPropsWithoutRef<"section"> & Partial<Props>;

export const Features1 = (props: Features1Props) => {
  const { tagline, heading, description, cardsSmall, cardBig } = {
    ...Features1Defaults,
    ...props,
  };
  return (
    <section className="px-[5%] py-8 md:py-12 lg:py-14 bg-accent dark:bg-neutral-950" >
      <div className="container">
        <div className="mb-12 md:mb-18 lg:mb-20">
          <div className="mx-auto max-w-lg text-center">
            <p className="mb-3 text-base text-muted-foreground uppercase md:mb-4 font-heading tracking-wider">{tagline}</p>
            <h2 className="mb-5 text-6xl font-heading md:mb-6 md:text-8xl lg:text-9xl tracking-tight">
              {heading}
            </h2>
            <p className="md:text-md ">{description}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:gap-4">
          <div className="grid grid-cols-1 gap-4 md:gap-4 lg:grid-cols-2">
            <div className="order-first flex flex-col items-stretch border border-border-primary lg:order-0 lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3 bg-card dark:bg-background rounded-lg">
              <div>
                <img
                  src={cardBig.image.src}
                  alt={cardBig.image.alt}
                  className="w-full object-cover rounded-t-lg"
                />
              </div>
              <div className="block flex-1 flex-col items-stretch justify-center p-6 md:flex md:p-8 lg:p-12">
                <div>
                  <p className="mb-2 font-sm text-muted-foreground uppercase font-heading tracking-wider" >{cardBig.tagline}</p>
                  <h3 className="mb-5 text-2xl font-heading leading-[1.2] md:mb-6 md:text-3xl lg:text-4xl">
                    {cardBig.heading}
                  </h3>
                  <p className="text-sm">{cardBig.description}</p>
                </div>
                <div className="mt-6 flex items-center gap-4 md:mt-8">
                  {cardBig.buttons.map((button, index) => (
                    <Button key={index} variant={button.variant} size={button.size}>{button.iconLeft && <span data-icon="inline-start">{button.iconLeft}</span>}{button.title}{button.iconRight && <span data-icon="inline-end">{button.iconRight}</span>}</Button>
                  ))}
                </div>
              </div>
            </div>
            {cardsSmall.map((card, index) => (
              <div
                key={index}
                className="order-last flex flex-col border border-border-primary md:grid md:grid-cols-2 lg:order-0 bg-card dark:bg-background rounded-lg"
              >
                <div className="flex w-full items-center justify-center">
                  <img src={card.image.src} alt={card.image.alt} className="w-full object-cover" />
                </div>
                <div className="block flex-col justify-center p-6 md:flex">
                  <div>
                    <p className="mb-2 text-xs uppercase text-muted-foreground font-heading tracking-wider">{card.tagline}</p>
                    <h3 className="mb-2 text-lg md:text-2xl font-heading leading-[1.12]">{card.heading}</h3>
                    <p className="text-sm">{card.description}</p>
                  </div>
                  <div className="mt-5 flex items-center gap-4 md:mt-6">
                    <Button variant={card.button.variant} size={card.button.size}>{card.button.iconLeft && <span data-icon="inline-start">{card.button.iconLeft}</span>}{card.button.title}{card.button.iconRight && <span data-icon="inline-end">{card.button.iconRight}</span>}</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
