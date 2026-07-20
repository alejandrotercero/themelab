import baseConfig from "@strastdas/oxc-config/base";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: [
    ...(baseConfig.ignorePatterns ?? []),
    "dist/**",
    "node_modules/**",
    "coverage/**",
  ],
});
