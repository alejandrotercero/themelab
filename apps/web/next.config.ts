import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Allow the dev server (incl. the HMR websocket) to be reached from other
  // devices on the LAN — Next 16 otherwise blocks non-localhost dev origins.
  allowedDevOrigins: ["192.168.1.201", "macmini.local"],
  // @themelab/shared and @themelab/theme-ui ship as TS source (no build step);
  // Next must transpile them now that we import their runtime helpers
  // (parseThemeInput, decodeTheme; the shared token controls).
  transpilePackages: ["@themelab/shared", "@themelab/theme-ui"],
}

export default nextConfig
