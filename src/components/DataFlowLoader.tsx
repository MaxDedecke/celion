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
        "relative flex items-center justify-center text-primary",
        SIZE_MAP[size],
        className,
      )}
      role="presentation"
      aria-hidden="true"
    >
      <div className="relative aspect-square w-full max-w-full">
        <div className="absolute inset-0 rounded-[32px] bg-primary/10 blur-xl animate-glow-pulse" />
        <div className="absolute inset-0 rounded-[28px] border border-primary/20 bg-gradient-to-br from-background/80 via-background/60 to-background/90 shadow-[0_12px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl" />

        <svg
          className="animate-network-float h-full w-full text-primary/40"
          viewBox="0 0 160 160"
        >
          <defs>
            <linearGradient id="loaderStroke" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.65" />
              <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.3" />
            </linearGradient>
            <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.1" />
            </radialGradient>
          </defs>

          <circle
            cx="80"
            cy="80"
            r="56"
            fill="none"
            stroke="url(#loaderStroke)"
            strokeWidth="1.5"
            className="network-line"
          />
          <circle
            cx="80"
            cy="80"
            r="38"
            fill="none"
            stroke="url(#loaderStroke)"
            strokeWidth="1"
            className="network-line"
          />
          <path
            d="M40 76 Q80 44 120 76"
            fill="none"
            stroke="url(#loaderStroke)"
            strokeWidth="1.5"
            className="network-line"
          />
          <path
            d="M45 100 Q80 128 115 100"
            fill="none"
            stroke="url(#loaderStroke)"
            strokeWidth="1.5"
            className="network-line"
          />

          {[{ cx: 80, cy: 40 }, { cx: 124, cy: 82 }, { cx: 80, cy: 124 }, { cx: 36, cy: 82 }].map(
            ({ cx, cy }, index) => (
              <circle
                key={cx + cy}
                cx={cx}
                cy={cy}
                r="7"
                fill="url(#nodeGlow)"
                className="network-node"
                style={{ animationDelay: `${index * 0.45}s` }}
              />
            ),
          )}
        </svg>

        <div className="pointer-events-none absolute inset-0">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="animate-orbit absolute inset-0"
              style={{
                animationDuration: `${14 + index * 3}s`,
                animationDirection: index % 2 === 0 ? "normal" : "reverse",
              }}
            >
              <span
                className="absolute left-1/2 top-0 block h-2 w-8 -translate-x-1/2 rounded-full bg-primary/70 shadow-[0_0_18px_rgba(56,189,248,0.45)]"
                style={{
                  transform: `translate(-50%, -50%) rotate(${index * 36}deg)`,
                }}
              />
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-0">
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              className="animate-particle absolute block h-1.5 w-1.5 rounded-full bg-primary/60"
              style={{
                left: `${25 + index * 15}%`,
                bottom: `${10 + index * 12}%`,
                animationDelay: `${index * 0.6}s`,
              }}
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Daten werden verarbeitet</span>
    </div>
  );
};

export default DataFlowLoader;
