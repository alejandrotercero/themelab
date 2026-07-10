import { describe, expect, it } from "vitest"
import { paletteToThemeStyles, THEME_TOKENS } from "../transpile"
import {
  decodeInstallPayload,
  encodeInstallPayload,
  createInstallCommand,
  InstallPayloadError,
  MAX_INSTALL_PAYLOAD_LENGTH,
} from "../install-payload"

const theme = paletteToThemeStyles("#8b5cf6", "#64748b")

function encodeRaw(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}

function rawPayload() {
  return {
    v: 1,
    n: "Violet",
    r: "0.625rem",
    l: THEME_TOKENS.map((token) => theme.light[token]),
    d: THEME_TOKENS.map((token) => theme.dark[token]),
  }
}

describe("install payload codec", () => {
  it("round-trips a complete theme deterministically", () => {
    const encoded = encodeInstallPayload({
      name: "Violet",
      radius: "0.625rem",
      theme,
    })

    expect(encoded).toBe(
      encodeInstallPayload({ name: "Violet", radius: "0.625rem", theme })
    )
    expect(decodeInstallPayload(encoded)).toEqual({
      version: 1,
      name: "Violet",
      radius: "0.625rem",
      theme,
    })
    expect(
      createInstallCommand(
        { name: "Violet", radius: "0.625rem", theme },
        "http://localhost:3000/"
      )
    ).toBe(
      `pnpm dlx shadcn@latest add http://localhost:3000/r/themes/${encoded}`
    )
  })

  it.each([
    ["malformed", "not-base64!", "INVALID_PAYLOAD"],
    [
      "unsupported version",
      encodeRaw({ ...rawPayload(), v: 2 }),
      "UNSUPPORTED_VERSION",
    ],
    [
      "incomplete light map",
      encodeRaw({ ...rawPayload(), l: ["#fff"] }),
      "INCOMPLETE_THEME",
    ],
    [
      "invalid color",
      encodeRaw({ ...rawPayload(), d: rawPayload().d.with(3, "not-a-color") }),
      "INVALID_COLOR",
    ],
    [
      "invalid radius",
      encodeRaw({ ...rawPayload(), r: "calc(1rem + 2px)" }),
      "INVALID_RADIUS",
    ],
    [
      "unsafe metadata",
      encodeRaw({ ...rawPayload(), n: "Bad\u0000name" }),
      "INVALID_METADATA",
    ],
  ] as const)("rejects %s", (_label, encoded, code) => {
    expect(() => decodeInstallPayload(encoded)).toThrowError(
      expect.objectContaining<Partial<InstallPayloadError>>({ code })
    )
  })

  it("rejects oversized input before decoding", () => {
    const encoded = "a".repeat(MAX_INSTALL_PAYLOAD_LENGTH + 1)
    expect(() => decodeInstallPayload(encoded)).toThrowError(
      expect.objectContaining<Partial<InstallPayloadError>>({
        code: "PAYLOAD_TOO_LARGE",
      })
    )
  })
})
