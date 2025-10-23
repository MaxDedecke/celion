import { cn } from "@/lib/utils";
import { useMinimumLoader } from "@/hooks/useMinimumLoader";

type DataFlowLoaderProps = {
  active?: boolean;
  minVisibleMs?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE_MAP: Record<NonNullable<DataFlowLoaderProps["size"]>, string> = {
  sm: "w-24",
  md: "w-32",
  lg: "w-40",
};

/**
 * Elegant loader that visualizes data moving through a network.
 * Keeps itself visible for a minimum amount of time to avoid flicker.
 */
const DataFlowLoader = ({
  active = true,
  minVisibleMs = 0,
  size = "md",
  className,
}: DataFlowLoaderProps) => {
  const shouldRender = useMinimumLoader(active, minVisibleMs);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-2xl border border-primary/25 bg-primary/5 p-6 text-primary",
        SIZE_MAP[size],
        className,
      )}
      role="presentation"
      aria-hidden="true"
    >
      <div className="relative h-14 w-full max-w-full">
        <div className="absolute left-[10%] top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="loader-node loader-node-first" />
        </div>
        <div className="absolute left-[10%] top-1/2 h-[2px] w-[40%] -translate-y-1/2">
          <span className="loader-connector loader-connector-first" />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="loader-node loader-node-second" />
        </div>
        <div className="absolute left-1/2 top-1/2 h-[2px] w-[40%] -translate-y-1/2">
          <span className="loader-connector loader-connector-second" />
        </div>
        <div className="absolute left-[90%] top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="loader-node loader-node-third" />
        </div>
      </div>
      <span className="sr-only">Daten werden verarbeitet</span>
    </div>
  );
};

export default DataFlowLoader;
