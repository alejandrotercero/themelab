import type React from "react";
import { cn } from "@/lib/utils";

// Aceternity UI — dot-background-demo, adapted from the showcase into a reusable
// wrapper: a 20px radial-dot grid with a faded radial mask. Children render above
// it. The arbitrary background-image/mask values are intrinsic to the effect.
export default function DotBackground({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full bg-accent dark:bg-neutral-950", className)}>
      <div
        className={cn(
          "absolute inset-0",
          "[background-size:20px_20px]",
          "[background-image:radial-gradient(#dddddd_1px,transparent_1px)]",
          "dark:[background-image:radial-gradient(#2a2a2a_1px,transparent_1px)]",
        )}
      />
      {/* Faded radial mask so the dots dissolve toward the edges. */}
      <div className="pointer-events-none absolute inset-0 bg-white/5 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)] dark:bg-black" />
      <div className="relative z-20">{children}</div>
    </div>
  );
}
