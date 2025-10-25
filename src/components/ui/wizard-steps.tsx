import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStep {
  title: string;
  description?: string;
}

interface WizardStepsProps {
  steps: WizardStep[];
  currentStep: number;
}

export const WizardSteps = ({ steps, currentStep }: WizardStepsProps) => {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <li
            key={step.title}
            className={cn(
              "flex items-start gap-3 rounded-2xl border bg-card/60 p-4 backdrop-blur-sm transition",
              isActive ? "border-primary/80 shadow-sm" : "border-border/60",
              isCompleted && !isActive ? "opacity-80" : undefined
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold",
                isCompleted
                  ? "border-primary bg-primary text-primary-foreground"
                  : isActive
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground"
              )}
            >
              {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">{step.title}</span>
              {step.description ? (
                <span className="text-xs text-muted-foreground">{step.description}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default WizardSteps;
