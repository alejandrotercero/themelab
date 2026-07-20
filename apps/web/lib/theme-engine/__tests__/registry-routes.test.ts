import { describe, expect, it } from "vitest"

import { GET as getCatalog } from "../../../app/r/registry.json/route"
import { GET as getTheme } from "../../../app/r/themes/[payload]/route"
import { encodeInstallPayload } from "../install-payload"
import { paletteToThemeStyles } from "../transpile"

describe("registry routes", () => {
  it("returns the stable JSON catalog with public cache headers", async () => {
    const first = await getCatalog()
    const second = await getCatalog()

    expect(first.status).toBe(200)
    expect(first.headers.get("content-type")).toContain("application/json")
    expect(first.headers.get("cache-control")).toContain("public")
    expect(await first.text()).toBe(await second.text())
  })

  it("awaits dynamic params and returns a generated registry item", async () => {
    const payload = encodeInstallPayload({
      name: "Route Theme",
      radius: "0.5rem",
      theme: paletteToThemeStyles("#22c55e", "#78716c"),
    })
    const response = await getTheme(
      new Request(`https://themelab.dev/r/themes/${payload}`),
      {
        params: Promise.resolve({ payload }),
      }
    )
    const stableResponse = await getTheme(
      new Request(`https://themelab.dev/r/themes/${payload}`),
      {
        params: Promise.resolve({ payload }),
      }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("immutable")
    const body = await response.text()
    expect(body).toBe(await stableResponse.text())
    expect(JSON.parse(body)).toEqual(
      expect.objectContaining({ title: "Route Theme", type: "registry:theme" })
    )
  })

  it("returns a structured 400 for malformed payloads", async () => {
    const response = await getTheme(
      new Request("https://themelab.dev/r/themes/nope!"),
      {
        params: Promise.resolve({ payload: "nope!" }),
      }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        code: "INVALID_PAYLOAD",
        message: expect.any(String),
      }),
    })
  })
})
