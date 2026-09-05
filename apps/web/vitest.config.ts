import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    include: [
      "lib/**/*.test.ts",
      "../../packages/theme-engine/src/**/*.test.ts",
    ],
  },
})
