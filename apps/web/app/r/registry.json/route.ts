import { createRegistryCatalog } from "@/lib/theme-engine/registry"

export function GET() {
  return Response.json(createRegistryCatalog(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  })
}
