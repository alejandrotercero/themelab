import { clsx } from "clsx";
export default function Card({ isMobile }: { isMobile: boolean }) {
  return (
    <div className={clsx("flex", { "gap-4": isMobile })}>
      Card
    </div>
  );
}
