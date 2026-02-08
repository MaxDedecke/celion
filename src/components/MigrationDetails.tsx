import { useCallback, useEffect, useState, forwardRef } from "react";
import MigrationChatCard from "./migration/MigrationChatCard";
import { toast } from "sonner";
import type { MigrationDetailsProps } from "./migration/migrationDetails.types";

export interface MigrationDetailsRef {
  // Kept for API compatibility, can be removed if not used elsewhere
}

const MigrationDetails = forwardRef<MigrationDetailsRef, MigrationDetailsProps>(({ project, onRefresh, onStepRunningChange }, ref) => {
  const [isStepRunning, setIsStepRunning] = useState(project.step_status === 'running');

  useEffect(() => {
    const running = project.step_status === 'running';
    setIsStepRunning(running);
    onStepRunningChange?.(running);
  }, [project.step_status, onStepRunningChange]);

  const handleNextWorkflowStep = useCallback(async (explicitStep?: number) => {
    if (isStepRunning && !explicitStep) return;

    try {
      // If the last step failed, we retry it (current_step). 
      // Otherwise we move to the next step (current_step + 1).
      const stepToRun = explicitStep || (project.step_status === 'failed' 
        ? (project.current_step || 1) 
        : (project.current_step || 0) + 1);

      if (stepToRun > 10) {
        toast.info("Migration bereits abgeschlossen.");
        return;
      }

      const response = await fetch(`/api/migrations/${project.id}/action/${stepToRun}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start step: ${errorText}`);
      }
      toast.success(explicitStep ? `Schritt ${stepToRun} wird wiederholt.` : `Schritt ${stepToRun} gestartet.`);
      await onRefresh();

    } catch (error) {
      console.error("Error progressing workflow:", error);
      const errorMessage = error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten";
      toast.error(`Fehler beim Fortschreiten des Workflows: ${errorMessage}`);
    }
  }, [project.id, project.current_step, project.step_status, isStepRunning, onRefresh]);

  const handleAction = useCallback((action: string) => {
    if (action === 'continue') {
      handleNextWorkflowStep();
    } else if (action.startsWith('retry:')) {
      const stepNum = parseInt(action.split(':')[1], 10);
      if (!isNaN(stepNum)) {
        handleNextWorkflowStep(stepNum);
      }
    }
  }, [handleNextWorkflowStep]);

  const handleSendChatMessage = useCallback(
    async (message: string) => {
      try {
        await fetch(`/api/migrations/${project.id}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: message,
          }),
        });
      } catch (error) {
        console.error("Fehler beim Speichern der Benutzernachricht:", error);
      }
      
      const trimmed = message.trim().toLowerCase();
      
      if (
        trimmed.includes("start") ||
        trimmed.includes("weiter") ||
        trimmed.includes("nächst") ||
        trimmed.includes("fortsetzen")
      ) {
        handleNextWorkflowStep();
      } else {
        toast.info("Verwende 'Fortsetzen' um den nächsten Schritt zu starten");
      }
    },
    [handleNextWorkflowStep, project.id]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <MigrationChatCard
          migration={project}
          onSendMessage={handleSendChatMessage}
          onContinue={handleNextWorkflowStep}
          onAction={handleAction}
          onOpenAgentOutput={(stepId) => console.log("onOpenAgentOutput not implemented", stepId)}
        />
      </div>
    </div>
  );
});

MigrationDetails.displayName = "MigrationDetails";

export default MigrationDetails;
