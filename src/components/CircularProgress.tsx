interface CircularProgressProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
}

const CircularProgress = ({ progress, size = 200, strokeWidth = 8 }: CircularProgressProps) => {
  const backgroundStrokeWidth = strokeWidth;
  const progressStrokeWidth = strokeWidth + 2;
  const maxStrokeWidth = Math.max(backgroundStrokeWidth, progressStrokeWidth);
  const radius = (size - maxStrokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  const getColor = () => {
    if (progress === 100) return "hsl(var(--success))";
    return "hsl(var(--primary))";
  };

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90 absolute">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--border))"
          strokeWidth={backgroundStrokeWidth}
          fill="none"
          opacity="0.3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={getColor()}
          strokeWidth={progressStrokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
    </div>
  );
};

export default CircularProgress;
