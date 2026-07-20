import { cn } from "@/lib/utils";

export default function Card({ isMobile }: { isMobile: boolean }) {
  return <div className={cn("flex", isMobile ? "gap-2" : "gap-4")}>Card</div>;
}
