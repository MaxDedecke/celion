import { useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import MigrationChatCard from "./migration/MigrationChatCard";
import WorkflowPanel from "./migration/WorkflowPanel";
import MappingPanel from "./migration/MappingPanel";
import { toast } from "sonner";
import type { MigrationDetailsProps } from "./migration/migrationDetails.types";
import { cn } from "@/lib/utils";

export interface MigrationDetailsRef {
  openWorkflowPanel: () => void;
}

const MigrationDetails = forwardRef<MigrationDetailsRef, MigrationDetailsProps>(({ 
  project, 
  onRefresh, 
  onStepRunningChange,
  activeView = 'chat'
}, ref) => {
  const [isStepRunning, setIsStepRunning] = useState(project.step_status === 'running');

  useImperativeHandle(ref, () => ({
    openWorkflowPanel: () => {
      // Logic for imperative call if still needed
    }
  }));

  useEffect(() => {
    const running = project.step_status === 'running';
    setIsStepRunning(running);
    onStepRunningChange?.(running);
  }, [project.step_status, onStepRunningChange]);

  const handleNextWorkflowStep = useCallback(async (explicitStep?: number) => {
    const validatedStep = typeof explicitStep === 'number' ? explicitStep : undefined;
    
    if (isStepRunning && !validatedStep) return;

    try {
      const stepToRun = validatedStep || (project.step_status === 'failed' 
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
      const trimmed = message.trim();
      const lower = trimmed.toLowerCase();
      
      if (
        lower === "start" || 
        lower === "weiter" || 
        lower === "nächster schritt" || 
        lower === "fortsetzen"
      ) {
        handleNextWorkflowStep();
        return;
      }

      try {
        const response = await fetch(`/api/migrations/${project.id}/chat/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: trimmed,
          }),
        });

        if (!response.ok) throw new Error("Consultant request failed");
        
        await onRefresh(); 
      } catch (error) {
        console.error("Fehler beim Senden der Consultant-Anfrage:", error);
        toast.error("Fehler beim Senden der Nachricht.");
      }
    },
    [handleNextWorkflowStep, project.id, onRefresh]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div 
        key={activeView}
        className="flex flex-1 flex-col overflow-hidden p-0 animate-in fade-in zoom-in-[0.98] duration-300 ease-out"
      >
        {activeView === 'chat' && (
          <MigrationChatCard
            migration={project}
            onSendMessage={handleSendChatMessage}
            onContinue={handleNextWorkflowStep}
            onAction={handleAction}
            onOpenAgentOutput={(stepId) => console.log("onOpenAgentOutput not implemented", stepId)}
          />
        )}
        {activeView === 'workflow' && (
          <div className="flex-1 overflow-hidden p-6 bg-muted/5 flex flex-col">
            <WorkflowPanel migrationId={project.id} />
          </div>
        )}
        {activeView === 'mapping' && (
          <div className="flex-1 overflow-hidden p-6 bg-muted/5 flex flex-col">
            <MappingPanel migrationId={project.id} />
          </div>
        )}
      </div>
    </div>
  );
});

MigrationDetails.displayName = "MigrationDetails";

export default MigrationDetails;