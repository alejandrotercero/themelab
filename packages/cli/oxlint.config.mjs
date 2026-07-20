import baseConfig from "@strastdas/oxc-config/base";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: [
    ...(baseConfig.ignorePatterns ?? []),
    "dist/**",
    "node_modules/**",
    "coverage/**",
    // Build artifact emitted by scripts/embed-overlay.mjs — not authored code.
    "src/generated/**",
    // Transform test fixtures are intentionally arbitrary user code.
    "src/__tests__/fixtures/**",
  ],
});
