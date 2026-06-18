import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["lib/theme-engine/**/*.test.ts"],
  },
});
