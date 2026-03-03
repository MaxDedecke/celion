import { useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import MigrationChatCard from "./migration/MigrationChatCard";
import WorkflowPanel from "./migration/WorkflowPanel";
import MappingPanel from "./migration/MappingPanel";
import EnhancementPanel from "./migration/EnhancementPanel";
import MigrationConfigPanel from "./migration/MigrationConfigPanel";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
import type { MigrationDetailsProps } from "./migration/migrationDetails.types";
import { cn } from "@/lib/utils";

export interface MigrationDetailsRef {
  openWorkflowPanel: () => void;
}

const MigrationDetails = forwardRef<MigrationDetailsRef, MigrationDetailsProps>(({ 
  project, 
  onRefresh, 
  onStepRunningChange,
  activeView = 'chat',
  onViewChange
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
    
    // Allow proceeding if the current step is completed and we're clicking 'continue'
    if (isStepRunning && !validatedStep) return;

    try {
      let stepToRun = validatedStep;
      
      if (!stepToRun) {
        if (project.step_status === 'failed') {
          stepToRun = project.current_step || 1;
        } else if (project.step_status === 'completed' || project.step_status === 'idle') {
          stepToRun = (project.current_step || 0) + 1;
        } else {
          // Fallback
          stepToRun = (project.current_step || 0) + 1;
        }
      }

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

  const handleAction = useCallback(async (action: string) => {
    if (action === 'continue') {
      handleNextWorkflowStep();
    } else if (action === 'confirm_transfer_plan') {
      try {
        const newScopeConfig = {
          ...(project.scopeConfig || {}),
          transferPlanApproved: true
        };
        
        const { error } = await databaseClient.updateMigration(project.id, {
          scope_config: newScopeConfig
        });
        
        if (error) throw error;
        
        toast.success("Transfer-Plan bestätigt. Migration wird gestartet...");
        handleNextWorkflowStep(8);
      } catch (error) {
        console.error("Error confirming transfer plan:", error);
        toast.error("Fehler bei der Plan-Bestätigung.");
      }
    } else if (action === 'reset_and_retry_transfer') {
      try {
        // 1. Reset approved flag in scope_config
        const newScopeConfig = {
          ...(project.scopeConfig || {}),
          transferPlanApproved: false
        };
        await databaseClient.updateMigration(project.id, {
          scope_config: newScopeConfig
        });

        // 2. Step 8 will handle the rest (Neo4j reset and DB reset) if we trigger it fresh
        toast.success("Transfer wird zurückgesetzt...");
        handleNextWorkflowStep(8);
      } catch (error) {
        console.error("Error resetting transfer:", error);
        toast.error("Fehler beim Zurücksetzen des Transfers.");
      }
    } else if (action.startsWith('retry:')) {
      const stepNum = parseInt(action.split(':')[1], 10);
      if (!isNaN(stepNum)) {
        handleNextWorkflowStep(stepNum);
      }
    } else if (action === 'open-mapping-ui') {
      onViewChange?.('mapping');
    } else if (action === 'open-enhancement-ui') {
      onViewChange?.('enhancement');
    } else if (action.startsWith('send_chat:')) {
      const msg = action.substring('send_chat:'.length);
      handleSendChatMessage(msg);
    }
  }, [handleNextWorkflowStep, onViewChange, project.id, project.scopeConfig]);

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
          <div className="flex-1 overflow-hidden flex flex-col">
            <WorkflowPanel migrationId={project.id} />
          </div>
        )}
        {activeView === 'mapping' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <MappingPanel 
              migrationId={project.id} 
              onClose={() => onViewChange?.('chat')}
              onTriggerStep={() => handleNextWorkflowStep(6)}
            />
          </div>
        )}
        {activeView === 'enhancement' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <EnhancementPanel 
              migrationId={project.id} 
              onClose={() => onViewChange?.('chat')}
              onTriggerStep={() => handleNextWorkflowStep(7)}
            />
          </div>
        )}
        {activeView === 'config' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <MigrationConfigPanel
              migrationId={project.id}
              projectId={project.projectId}
              onClose={() => onViewChange?.('chat')}
              onUpdate={onRefresh}
            />
          </div>
        )}
      </div>
    </div>
  );
});

MigrationDetails.displayName = "MigrationDetails";

export default MigrationDetails;
