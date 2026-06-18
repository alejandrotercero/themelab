import { cn } from "@/lib/utils";
export default function Button({ className }: { className?: string }) {
  return (
    <button className={cn("flex items-center", className)}>
      Button
    </button>
  );
}
