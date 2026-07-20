import nextReactConfig from "@strastdas/oxc-config/next-react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [nextReactConfig],
  ignorePatterns: [
    ...(nextReactConfig.ignorePatterns ?? []),
    "dist/**",
    "node_modules/**",
    "coverage/**",
  ],
});
