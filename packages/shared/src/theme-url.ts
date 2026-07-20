// Compact, URL-safe encoding of a ThemeStyles, used for the studio's /edit
// deep-link (`/edit#theme=<encoded>`). Base64url over the UTF-8 JSON — keeps the
// full 62-token theme well under URL length limits and needs no backend.

import type { ThemeStyles } from "./types";

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCodePoint(b);
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  let b64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.codePointAt(i) ?? 0;
  }
  return new TextDecoder().decode(bytes);
}

/** Encode a theme for the `/edit#theme=` deep-link. */
export function encodeTheme(theme: ThemeStyles): string {
  return toBase64Url(JSON.stringify({ light: theme.light, dark: theme.dark }));
}

/** Decode a `/edit#theme=` value back into a ThemeStyles, or null if invalid. */
export function decodeTheme(encoded: string): ThemeStyles | null {
  try {
    const obj = JSON.parse(fromBase64Url(encoded)) as unknown;
    if (obj && typeof obj === "object") {
      const t = obj as { light?: unknown; dark?: unknown };
      if (
        t.light &&
        typeof t.light === "object" &&
        t.dark &&
        typeof t.dark === "object"
      ) {
        return {
          light: t.light as Record<string, string>,
          dark: t.dark as Record<string, string>,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
