import { cn } from "@/lib/utils";

const sizeClass = "gap-4 p-4";
export default function Card({ base }: { base: string }) {
  return <div className={cn(base, "flex")}>Card</div>;
}
