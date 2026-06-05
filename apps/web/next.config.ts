import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Allow the dev server (incl. the HMR websocket) to be reached from other
  // devices on the LAN — Next 16 otherwise blocks non-localhost dev origins.
  allowedDevOrigins: ["192.168.1.201"],
}

export default nextConfig
