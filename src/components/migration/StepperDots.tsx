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
        const isPending = index > completedSteps || (index === completedSteps && !isCurrentStepRunning && !hasCurrentStepFailed);

        return (
          <div
            key={index}
            className={cn(
              "h-2 w-2 rounded-full transition-all duration-300",
              isCompleted && "bg-primary",
              isActive && "bg-primary animate-pulse scale-125",
              isFailed && "bg-destructive scale-110",
              isPending && "bg-muted-foreground/30"
            )}
          />
        );
      })}
    </div>
  );
};

export default StepperDots;
