import { cn } from "@/lib/utils";

interface StepperDotsProps {
  totalSteps: number;
  completedSteps: number;
  isCurrentStepRunning: boolean;
  hasCurrentStepFailed?: boolean;
}

const StepperDots = ({ totalSteps, completedSteps, isCurrentStepRunning, hasCurrentStepFailed }: StepperDotsProps) => {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const isCompleted = index < completedSteps;
        const isActive = index === completedSteps && isCurrentStepRunning;
        const isFailed = index === completedSteps && hasCurrentStepFailed && !isCurrentStepRunning;
        const isNext = index === completedSteps && !isCurrentStepRunning && !hasCurrentStepFailed;
        const isFuture = index > completedSteps;

        return (
          <div
            key={index}
            className={cn(
              "h-2 w-2 rounded-full transition-all duration-300",
              isCompleted && "bg-emerald-500",
              isActive && "bg-blue-500 animate-pulse scale-125",
              isNext && "bg-blue-500",
              isFailed && "bg-destructive scale-110",
              isFuture && "bg-muted-foreground/30"
            )}
          />
        );
      })}
    </div>
  );
};

export default StepperDots;
