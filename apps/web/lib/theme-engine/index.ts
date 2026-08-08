// The web product keeps hosted registry/install concerns here. The reusable color and
// theme-generation engine lives in @themelab/theme-engine so Desktop uses identical logic.
export * from "@themelab/theme-engine"
export {
  decodeInstallPayload,
  encodeInstallPayload,
  createInstallCommand,
  createThemeRegistryUrl,
  InstallPayloadError,
  INSTALL_PAYLOAD_VERSION,
  MAX_INSTALL_PAYLOAD_LENGTH,
  type EncodeInstallPayloadInput,
  type InstallPayloadErrorCode,
  type InstallTheme,
} from "./install-payload"
export { createRegistryCatalog, installPayloadToRegistryItem } from "./registry"
