// The ThemeLab wordmark, ported from packages/overlay/src/brand.ts
// (BRAND_LOGO_SVG). Uses currentColor so it inherits the surrounding text color.

import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 263 30"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- inline vector wordmark; the standard a11y pattern for an inline <svg> icon is role="img", not an <img> tag (that would require rasterizing the paths and lose currentColor theming)
      role="img"
      aria-label="ThemeLab"
      className={cn("w-auto", className)}
    >
      <path d="M25.012 5.00017H15.0068V30H10.0052V5.00017H0V0H25.012V5.00017Z" />
      <path d="M39.0009 10.0003H54.0077V0H59.0103V30H54.0077V15.0005H39.0009V30H33.9983V0H39.0009V10.0003Z" />
      <path d="M93.0086 5.00017H72.9992V10.0003H88.006V15.0005H72.9992V24.9998H93.0086V30H67.9966V0H93.0086V5.00017Z" />
      <path d="M106.997 5.00017H112V10.0003H106.997V30H101.995V0H106.997V5.00017Z" />
      <path d="M127.007 30H122.004V10.0003H117.002V5.00017H122.004V0H127.007V30Z" />
      <path d="M161.005 5.00017H140.996V10.0003H156.003V15.0005H140.996V24.9998H161.005V30H135.993V0H161.005V5.00017Z" />
      <path d="M174.994 24.9998H195.003V30H169.991V0H174.994V24.9998Z" />
      <path d="M208.992 15.0005H223.999V10.0003H229.002V30H223.999V19.9997H208.992V30H203.99V10.0003H208.992V15.0005Z" />
      <path d="M257.997 5.00017H242.991V10.0003H257.997V15.0005H242.991V24.9998H257.997V30H237.988V0H257.997V5.00017Z" />
      <path d="M263 24.9998H257.997V15.0005H263V24.9998Z" />
      <path d="M117.002 19.9997H112V10.0003H117.002V19.9997Z" />
      <path d="M213.995 10.0003H208.992V5.00017H213.995V10.0003Z" />
      <path d="M223.999 10.0003H218.996V5.00017H223.999V10.0003Z" />
      <path d="M263 10.0003H257.997V5.00017H263V10.0003Z" />
      <path d="M218.996 5.00017H213.995V0H218.996V5.00017Z" />
    </svg>
  )
}
