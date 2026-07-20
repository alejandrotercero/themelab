import { defineConfig } from "oxfmt";
import ultraciteConfig from "ultracite/oxfmt";

export default defineConfig({
  ...ultraciteConfig,
  endOfLine: "lf",
  printWidth: 80,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  overrides: [
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      options: {
        semi: false,
        sortTailwindcss: {
          functions: ["cn", "cva"],
          stylesheet: "apps/web/app/globals.css",
        },
      },
    },
  ],
});
