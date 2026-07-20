import { cn } from "@/lib/utils";

const extraClasses = ["gap-4", "p-4"];
export default function Card() {
  return <div className={cn("flex", ...extraClasses)}>Card</div>;
}
