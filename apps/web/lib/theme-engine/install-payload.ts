import type { ThemeStyles } from "@themelab/shared"
import { sanitizeThemeName } from "./design-md"
import { toOklch } from "./oklch"
import { THEME_TOKENS } from "./transpile"

export const INSTALL_PAYLOAD_VERSION = 1 as const
export const MAX_INSTALL_PAYLOAD_LENGTH = 8_192

export type InstallPayloadErrorCode =
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_VERSION"
  | "INCOMPLETE_THEME"
  | "INVALID_COLOR"
  | "INVALID_RADIUS"
  | "INVALID_METADATA"

export class InstallPayloadError extends Error {
  constructor(
    public readonly code: InstallPayloadErrorCode,
    message: string
  ) {
    super(message)
    this.name = "InstallPayloadError"
  }
}

interface WirePayload {
  v: number
  n: string
  r: string
  l: string[]
  d: string[]
}

export interface InstallTheme {
  version: typeof INSTALL_PAYLOAD_VERSION
  name: string
  radius: string
  theme: ThemeStyles
}

export interface EncodeInstallPayloadInput {
  name: string
  radius: string
  theme: ThemeStyles
}

const RADIUS_PATTERN = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em))$/u
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !name || name !== sanitizeThemeName(name)) {
    throw new InstallPayloadError(
      "INVALID_METADATA",
      "Theme name contains unsupported metadata."
    )
  }
}

function assertRadius(radius: unknown): asserts radius is string {
  if (
    typeof radius !== "string" ||
    radius.length > 32 ||
    !RADIUS_PATTERN.test(radius)
  ) {
    throw new InstallPayloadError(
      "INVALID_RADIUS",
      "Radius must be zero or a non-negative px, rem, or em dimension."
    )
  }
}

function assertMode(
  value: unknown,
  mode: "light" | "dark"
): asserts value is string[] {
  if (!Array.isArray(value) || value.length !== THEME_TOKENS.length) {
    throw new InstallPayloadError(
      "INCOMPLETE_THEME",
      `The ${mode} theme must contain every canonical shadcn color token.`
    )
  }
  for (let index = 0; index < value.length; index++) {
    const color = value[index]
    if (
      typeof color !== "string" ||
      color.length > 160 ||
      toOklch(color) === null
    ) {
      throw new InstallPayloadError(
        "INVALID_COLOR",
        `Invalid CSS color for ${mode}.${THEME_TOKENS[index]}.`
      )
    }
  }
}

function toWire(input: EncodeInstallPayloadInput): WirePayload {
  const name = sanitizeThemeName(input.name)
  assertName(name)
  assertRadius(input.radius)
  const light = THEME_TOKENS.map((token) => input.theme.light[token])
  const dark = THEME_TOKENS.map((token) => input.theme.dark[token])
  assertMode(light, "light")
  assertMode(dark, "dark")
  return {
    v: INSTALL_PAYLOAD_VERSION,
    n: name,
    r: input.radius,
    l: light,
    d: dark,
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4)
  const binary = atob(
    encoded.replaceAll("-", "+").replaceAll("_", "/") + padding
  )
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function encodeInstallPayload(input: EncodeInstallPayloadInput): string {
  const encoded = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(toWire(input)))
  )
  if (encoded.length > MAX_INSTALL_PAYLOAD_LENGTH) {
    throw new InstallPayloadError(
      "PAYLOAD_TOO_LARGE",
      "Theme payload exceeds the URL size limit."
    )
  }
  return encoded
}

export function createThemeRegistryUrl(
  input: EncodeInstallPayloadInput,
  origin: string
): string {
  return `${origin.replace(/\/+$/u, "")}/r/themes/${encodeInstallPayload(input)}`
}

export function createInstallCommand(
  input: EncodeInstallPayloadInput,
  origin: string
): string {
  return `pnpm dlx shadcn@latest add ${createThemeRegistryUrl(input, origin)}`
}

export function decodeInstallPayload(encoded: string): InstallTheme {
  if (encoded.length > MAX_INSTALL_PAYLOAD_LENGTH) {
    throw new InstallPayloadError(
      "PAYLOAD_TOO_LARGE",
      "Theme payload exceeds the URL size limit."
    )
  }
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) {
    throw new InstallPayloadError(
      "INVALID_PAYLOAD",
      "Theme payload is not valid base64url data."
    )
  }

  let value: unknown
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlToBytes(encoded)
      )
    )
  } catch {
    throw new InstallPayloadError(
      "INVALID_PAYLOAD",
      "Theme payload is not valid encoded JSON."
    )
  }
  if (!isRecord(value)) {
    throw new InstallPayloadError(
      "INVALID_PAYLOAD",
      "Theme payload must be an object."
    )
  }
  if (value.v !== INSTALL_PAYLOAD_VERSION) {
    throw new InstallPayloadError(
      "UNSUPPORTED_VERSION",
      "Theme payload version is not supported."
    )
  }

  assertName(value.n)
  assertRadius(value.r)
  assertMode(value.l, "light")
  assertMode(value.d, "dark")

  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}
  for (let index = 0; index < THEME_TOKENS.length; index++) {
    light[THEME_TOKENS[index]] = value.l[index]
    dark[THEME_TOKENS[index]] = value.d[index]
  }

  return {
    version: INSTALL_PAYLOAD_VERSION,
    name: value.n,
    radius: value.r,
    theme: { light, dark },
  }
}
