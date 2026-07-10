import {
  InstallPayloadError,
  installPayloadToRegistryItem,
} from "@/lib/theme-engine"

interface ThemeRouteContext {
  params: Promise<{ payload: string }>
}

export async function GET(_request: Request, context: ThemeRouteContext) {
  const { payload } = await context.params
  try {
    return Response.json(installPayloadToRegistryItem(payload), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    const payloadError =
      error instanceof InstallPayloadError
        ? error
        : new InstallPayloadError(
            "INVALID_PAYLOAD",
            "Theme payload could not be decoded."
          )
    return Response.json(
      { error: { code: payloadError.code, message: payloadError.message } },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }
}
