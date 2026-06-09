"use client";;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ButtonProps } from "@/components/ui/button";
import { useState } from "react";
import { Logo } from "@/components/logo";
import Link from "next/link";


type ImageProps = {
  url?: string;
  src: string;
  alt?: string;
};

type Links = {
  title: string;
  url: string;
};

type ColumnLinks = {
  title: string;
  links: Links[];
};

type Props = {
  logo: ImageProps;
  newsletterHeading: string;
  newsletterDescription: string;
  inputPlaceholder?: string;
  button: ButtonProps;
  termsAndConditions: string;
  columnLinks: ColumnLinks[];
  footerText?: string;
};

export type FooterProps = React.ComponentPropsWithoutRef<"section"> & Partial<Props>;

export const Footer = (props: FooterProps) => {
  const {

    newsletterHeading,
    newsletterDescription,
    inputPlaceholder,
    button,
    termsAndConditions,

    footerText,
  } = {
    ...FooterDefaults,
    ...props,
  };

  const [emailInput, setEmailInput] = useState<string>("");
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log({
      emailInput,
    });
  };

  return (
    <footer className="px-[5%] py-8 bg-foreground text-background dark:bg-background dark:text-foreground ">
      <div className="container">




        <div className="flex flex-col items-start pb-4 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between ">
          <Link href="/" aria-label="ThemeLab home" className="flex items-center">
            <Logo className="h-3.5" />
          </Link>
          <p className="text-sm uppercase">{footerText}</p>
        </div>
      </div>
    </footer>
  );
};

export const FooterDefaults: Props = {
  logo: {
    url:"#",
    src:"https://r2.110696.xyz/logoipsum-317.svg",
    alt:"Logo image",
  },
  newsletterHeading:"Join our newsletter",
  newsletterDescription:"Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  inputPlaceholder:"Enter your email",
  button: {
    title:"Subscribe",
    variant:"outline",
    size:"sm",
  },
  termsAndConditions: `
  <p class='text-xs'>
    By subscribing you agree to with our
    <a href='#' class='underline'>Privacy Policy</a>.
  </p>
  `,
  columnLinks: [
    {
      title:"Column One",
      links: [
        { title:"Link One", url:"#" },
        { title:"Link Two", url:"#" },
        { title:"Link Three", url:"#" },
        { title:"Link Four", url:"#" },
        { title:"Link Five", url:"#" },
      ],
    },
    {
      title:"Column Two",
      links: [
        { title:"Link Six", url:"#" },
        { title:"Link Seven", url:"#" },
        { title:"Link Eight", url:"#" },
        { title:"Link Nine", url:"#" },
        { title:"Link Ten", url:"#" },
      ],
    },
    {
      title:"Column Three",
      links: [
        { title:"Link Eleven", url:"#" },
        { title:"Link Twelve", url:"#" },
        { title:"Link Thirteen", url:"#" },
        { title:"Link Fourteen", url:"#" },
        { title:"Link Fifteen", url:"#" },
      ],
    },
    {
      title:"Column Four",
      links: [
        { title:"Link Sixteen", url:"#" },
        { title:"Link Seventeen", url:"#" },
        { title:"Link Eighteen", url:"#" },
        { title:"Link Nineteen", url:"#" },
        { title:"Link Twenty", url:"#" },
      ],
    },
    {
      title:"Column Five",
      links: [
        { title:"Link Twenty One", url:"#" },
        { title:"Link Twenty Two", url:"#" },
        { title:"Link Twenty Three", url:"#" },
        { title:"Link Twenty Four", url:"#" },
        { title:"Link Twenty Five", url:"#" },
      ],
    },
    {
      title:"Column Six",
      links: [
        { title:"Link Twenty Six", url:"#" },
        { title:"Link Twenty Seven", url:"#" },
        { title:"Link Twenty Eight", url:"#" },
        { title:"Link Twenty Nine", url:"#" },
        { title:"Link Thirty", url:"#" },
      ],
    },
  ],
  footerText:"© 2026. All rights reserved.",
};
