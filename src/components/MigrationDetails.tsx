import { useCallback, useEffect, useMemo, useRef, useState, useId, forwardRef, useImperativeHandle } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import { supabaseDatabase } from "@/api/supabaseDatabase";
import { runAuthFlowAgent, runCapabilityDiscoveryAgent, runSystemDetectionAgent } from "@/agents/agentService";
import type {
  AuthFlowResult,
  AuthFlowStepResult,
  CapabilityDiscoveryResult,
  SystemDetectionResult,
  SystemDetectionStepResult,
} from "@/types/agents";
import type { MigrationStatus } from "@/types/migration";
import type { WorkflowBoardState, WorkflowNode } from "@/types/workflow";
import WorkflowPanelDialog from "./dialogs/WorkflowPanelDialog";
import type { Activity } from "./ActivityTimeline";
import AgentResultDialog from "./migration/AgentResultDialog";
import MigrationChatCard from "./migration/MigrationChatCard";
import type { AgentWorkflowStepState, MigrationProject } from "./migration/types";
import { getWorkflowTheme } from "./migration/workflowThemes";
import { nodeHasAgentResult } from "./migration/workflowUtils";
import { toast } from "sonner";
import { AgentExecutionError } from "./migration/errors";
import {
  MIGRATION_STATUS_META,
} from "./migration/migrationDetails.constants";
import type {
  AuthContext,
  ConnectorRecord,
  MigrationDetailsProps,
  RawActivityRecord,
} from "./migration/migrationDetails.types";
import {
  cacheWorkflowStateSnapshot,
  clampProgressValue,
  confidenceToPercent,
  createDefaultWorkflowBoard,
  deserializeWorkflowState,
  formatProgressPair,
  hasSuccessfulSystemDetectionResult,
  isStepStructuredResult,
  loadCachedWorkflowState,
  normalizeAuthFlowResult,
  normalizeAuthFlowStepResult,
  normalizeCapabilityDiscoveryResult,
  normalizeSystemDetectionResult,
  normalizeSystemDetectionStepResult,
  parseProgressPair,
  serializeWorkflowState,
  simulateSourceObjects,
  simulateTargetObjects,
} from "./migration/migrationDetails.helpers";

/**
 * Extracts a human-readable output from agent results for display in chat.
 * Prioritizes explanation/summary fields over raw output.
 */
const extractAgentReadableOutput = (
  result: SystemDetectionStepResult | AuthFlowStepResult | CapabilityDiscoveryResult | undefined
): string | null => {
  if (!result) return null;

  // AuthFlowStepResult - has source/target with explanation
  if ('source' in result && result.source && 'explanation' in result.source) {
    const authResult = result as AuthFlowStepResult;
    const sourceExpl = (authResult.source as AuthFlowResult)?.explanation;
    const targetExpl = (authResult.target as AuthFlowResult)?.explanation;
    const combined = [sourceExpl, targetExpl].filter(Boolean).join(' ');
    if (combined.trim()) return combined.trim();
    
    // Fallback to summary
    const sourceSummary = (authResult.source as AuthFlowResult)?.summary;
    const targetSummary = (authResult.target as AuthFlowResult)?.summary;
    const summaryText = [sourceSummary, targetSummary].filter(Boolean).join(' ');
    if (summaryText.trim()) return summaryText.trim();
  }

  // CapabilityDiscoveryResult - summarize object counts
  if ('objects' in result && result.objects && typeof result.objects === 'object') {
    const capability = result as CapabilityDiscoveryResult;
    const entries = Object.entries(capability.objects || {})
      .map(([key, value]) => {
        const info = value as { count?: number; error?: string | null };
        const countText = typeof info.count === 'number' ? info.count : 0;
        const errorText = info.error ? ` (Fehler: ${info.error})` : '';
        return `${key}: ${countText}${errorText}`;
      })
      .filter(Boolean);

    if (entries.length > 0) {
      return entries.join('; ');
    }
  }

  // SystemDetectionStepResult - has source/target with rawOutput
  // For system detection, we use rawOutput but keep it brief
  if ('source' in result && result.source && 'rawOutput' in result.source) {
    const sysResult = result as SystemDetectionStepResult;
    const sourceRaw = (sysResult.source as SystemDetectionResult)?.rawOutput;
    const targetRaw = (sysResult.target as SystemDetectionResult)?.rawOutput;
    // Only use rawOutput if it's reasonably short (under 500 chars)
    const combined = [sourceRaw, targetRaw]
      .filter(Boolean)
      .filter(text => text && text.length < 500)
      .join('\n\n');
    if (combined.trim()) return combined.trim();
  }

  return null;
};

export interface MigrationDetailsRef {
  openWorkflowPanel: () => void;
}

const STEP_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const MigrationDetails = forwardRef<MigrationDetailsRef, MigrationDetailsProps>(({ project, onRefresh, onStepRunningChange }, ref) => {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [status, setStatus] = useState<MigrationStatus>(project.status ?? "not_started");
  const [activityLog, setActivityLog] = useState<Activity[]>(project.activities ?? []);
  const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
  const [workflowPanelSelection, setWorkflowPanelSelection] = useState<string | null>(null);
  const [isStepRunning, setIsStepRunning] = useState(false);
  const [stepProgress, setStepProgress] = useState(0);
  const [agentResultDialogStepId, setAgentResultDialogStepId] = useState<string | null>(null);
  const [workflowBoard, setWorkflowBoard] = useState<WorkflowBoardState>(() => createDefaultWorkflowBoard());
  const agentResultPersistenceSignatureRef = useRef<string | null>(null);

  const createViewResultActivity = useCallback(
    async (stepNode: WorkflowNode, isError: boolean = false) => {
      const viewResultActivity = `Hier gehts zum Agenten Output [step:${stepNode.id}]`;
      
      await supabaseDatabase.insertMigrationActivity({
        migration_id: project.id,
        type: isError ? "warning" : "info",
        title: viewResultActivity,
        timestamp: new Date().toISOString()
      });
      
      setActivityLog((previous) => [
        {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: isError ? "warning" : "info",
          title: viewResultActivity,
          timestamp: new Date().toISOString(),
        },
        ...previous,
      ]);
    },
    [project.id]
  );

  const appendActivity = useCallback(
    async (type: Activity["type"], title: string) => {
      const timestampIso = new Date().toISOString();

      try {
        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type,
          title,
          timestamp: timestampIso,
        });
      } catch (error) {
        console.error("Fehler beim Schreiben eines Aktivitätseintrags:", error);
      }

      setActivityLog((previous) => [
        {
          id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          title,
          timestamp: timestampIso,
        },
        ...previous,
      ]);
    },
    [project.id, setActivityLog],
  );

  const normalizeWorkflowState = useCallback((state: WorkflowBoardState): WorkflowBoardState => {
    const nodesWithDefaults = state.nodes.map((node, index) => ({
      ...node,
      active: typeof node.active === "boolean" ? node.active : true,
      priority: typeof node.priority === "number" ? node.priority : index + 1,
      agentPrompt: typeof node.agentPrompt === "string" ? node.agentPrompt : "",
      __originalIndex: index,
    }));

    const sortedNodes = [...nodesWithDefaults].sort((a, b) => {
      if (a.priority === b.priority) {
        return a.__originalIndex - b.__originalIndex;
      }
      return a.priority - b.priority;
    });

    const normalizedNodes = sortedNodes.map((node, index) => {
      const { __originalIndex, ...rest } = node;
      return {
        ...rest,
        priority: index + 1,
      };
    });

    return {
      nodes: normalizedNodes,
      connections: state.connections,
    };
  }, []);

  const handleWorkflowChange = useCallback(
    (updater: (previous: WorkflowBoardState) => WorkflowBoardState) => {
      setWorkflowBoard((previous) => normalizeWorkflowState(updater(previous)));
    },
    [normalizeWorkflowState],
  );

  const handleOpenWorkflowPanel = useCallback((nodeId?: string) => {
    setWorkflowPanelSelection(nodeId ?? null);
    setIsWorkflowPanelOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({
    openWorkflowPanel: () => handleOpenWorkflowPanel()
  }), [handleOpenWorkflowPanel]);

  const handleDeleteWorkflowNode = useCallback(
    (nodeId: string) => {
      handleWorkflowChange((previous) => ({
        ...previous,
        nodes: previous.nodes.filter((node) => node.id !== nodeId),
        connections: previous.connections.filter(
          (connection) => connection.sourceId !== nodeId && connection.targetId !== nodeId,
        ),
      }));
    },
    [handleWorkflowChange],
  );

  const handleToggleWorkflowNodeActive = useCallback(
    (nodeId: string) => {
      handleWorkflowChange((previous) => ({
        ...previous,
        nodes: previous.nodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }

          const nextActive = !node.active;
          return {
            ...node,
            active: nextActive,
            status: nextActive ? node.status : "pending",
          };
        }),
      }));
    },
    [handleWorkflowChange],
  );

  const handleUpdateStatus = useCallback(
    async (nextStatus: MigrationStatus) => {
      if (nextStatus === status) {
        return;
      }

      const eventTimestamp = new Date();
      const timestampIso = eventTimestamp.toISOString();

      try {
        setIsUpdatingStatus(true);
        await new Promise((resolve) => setTimeout(resolve, 400));

        setStatus(nextStatus);

        const activityTitle =
          nextStatus === "running"
            ? "Migration gestartet"
            : nextStatus === "completed"
              ? "Migration abgeschlossen"
              : nextStatus === "paused"
                ? "Migration pausiert"
                : "Migrationsstatus aktualisiert";

        const activityType =
          nextStatus === "completed"
            ? "success"
            : nextStatus === "paused"
              ? "warning"
              : "info";

        const { error: activityError } = await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: activityType,
          title: activityTitle,
          timestamp: timestampIso,
        });

        if (activityError) throw activityError;

        setActivityLog((previous) => [
          {
            id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: activityType,
            title: activityTitle,
            timestamp: timestampIso,
          },
          ...previous,
        ]);

        if (nextStatus === "running") {
          toast.success("Migration erfolgreich gestartet");
        } else if (nextStatus === "completed") {
          toast.success("Migration abgeschlossen");
        } else if (nextStatus === "paused") {
          toast.info("Migration pausiert");
        } else {
          toast.success("Status aktualisiert");
        }
      } catch (error) {
        console.error("Fehler beim Aktualisieren des Migrationsstatus:", error);
        await appendActivity("error", "Status konnte nicht aktualisiert werden");
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [status, project.id],
  );

  const ensureSystemDetectionRetryable = useCallback(
    async (board: WorkflowBoardState): Promise<WorkflowBoardState> => {
      const systemDetectionIndex = board.nodes.findIndex((node) => node.id === "system-detection");

      if (systemDetectionIndex === -1) {
        return board;
      }

      const detectionNode = board.nodes[systemDetectionIndex];
      const detectionCompleted = hasSuccessfulSystemDetectionResult(
        detectionNode.agentResult,
        project.sourceSystem,
        project.targetSystem,
      );

      if (detectionCompleted || detectionNode.status === "pending") {
        return board;
      }

      const updatedNodes = board.nodes.map((node, index) => {
        if (index !== systemDetectionIndex) {
          return node;
        }

        return {
          ...node,
          status: "pending" as const,
        };
      });

      const nextState: WorkflowBoardState = {
        ...board,
        nodes: updatedNodes,
      };

      setWorkflowBoard(nextState);
      cacheWorkflowStateSnapshot(project.id, nextState);

      try {
        await supabaseDatabase.updateMigration(project.id, {
          workflow_state: serializeWorkflowState(nextState) as any,
        });
      } catch (error) {
        console.error("Fehler beim Aktualisieren des Workflow-Status für die Systemerkennung:", error);
      }

      return nextState;
    },
    [project.id, project.sourceSystem, project.targetSystem],
  );

  const handleNextWorkflowStep = useCallback(async () => {
    if (isStepRunning) return;

    try {
      // Reset progress to 0 at the start of a new step
      setStepProgress(0);
      setIsStepRunning(true);
      onStepRunningChange?.(true);

      const boardForExecution = await ensureSystemDetectionRetryable(workflowBoard);
      const nodesSnapshot = boardForExecution.nodes.map((node) => ({ ...node }));
      const activeStepIndex = nodesSnapshot.findIndex((node) => node.status === "in-progress");
      const nextPendingIndex = nodesSnapshot.findIndex((node) => node.status !== "done");
      const stepIndexToComplete = activeStepIndex !== -1 ? activeStepIndex : nextPendingIndex;

      if (stepIndexToComplete === -1) {
        setStatus("completed");
        await onRefresh();
        return;
      }

      const stepToRun = nodesSnapshot[stepIndexToComplete];
      
      // --- Start Agent Parameter Preparation ---
      let agentName: string | undefined = stepToRun.agentType;
      let agentParams: any = {};

      if (stepToRun.agentType === "system-detection") {
        agentName = 'runSystemDetection';
        agentParams = {
          sourceUrl: (project.sourceUrl ?? project.inConnectorDetail ?? "").trim(),
          sourceExpectedSystem: project.sourceSystem,
          targetUrl: (project.targetUrl ?? project.outConnectorDetail ?? "").trim(),
          targetExpectedSystem: project.targetSystem,
        };
      } else if (stepToRun.agentType === "auth-flow") {
        agentName = 'runAuthFlow';
        const { data: connectorRows, error: connectorsError } = await supabaseDatabase.fetchConnectorsByMigration(project.id);
        if (connectorsError) throw new Error("Konnektordaten konnten nicht geladen werden.");
        
        const connectors = (connectorRows ?? []) as ConnectorRecord[];
        const sourceConnector = connectors.find((record) => record.connector_type === "in");
        const targetConnector = connectors.find((record) => record.connector_type === "out");

        agentParams = {
          source: {
            system: project.sourceSystem,
            baseUrl: (sourceConnector?.api_url ?? project.sourceUrl ?? project.inConnectorDetail ?? "").trim(),
            apiToken: (sourceConnector?.api_key ?? "").trim(),
            email: (sourceConnector?.username ?? "").trim(),
          },
          target: {
            system: project.targetSystem,
            baseUrl: (targetConnector?.api_url ?? project.targetUrl ?? project.outConnectorDetail ?? "").trim(),
            apiToken: (targetConnector?.api_key ?? "").trim(),
            email: (targetConnector?.username ?? "").trim(),
          },
        };
      } else if (stepToRun.agentType === "schema-discovery") {
        agentName = 'runCapabilityDiscovery';
        const { data: connectorRows, error: connectorsError } = await supabaseDatabase.fetchConnectorsByMigration(project.id);
        if (connectorsError) throw new Error("Konnektordaten konnten nicht geladen werden.");

        const connectors = (connectorRows ?? []) as ConnectorRecord[];
        const sourceConnector = connectors.find((record) => record.connector_type === "in");

        agentParams = {
          baseUrl: (project.sourceUrl ?? project.inConnectorDetail ?? sourceConnector?.api_url ?? "").trim(),
          system: project.sourceSystem,
          apiToken: (sourceConnector?.api_key ?? "").trim(),
          email: (sourceConnector?.username ?? "").trim(),
        };
      }
      // --- End Agent Parameter Preparation ---

      if (activeStepIndex === -1) {
        const startedActivity = `Schritt gestartet: ${stepToRun.title}`;
        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: "info",
          title: startedActivity,
          timestamp: new Date().toISOString()
        });
        setActivityLog((previous) => [{
          id: `workflow-${Date.now()}`,
          type: "info",
          title: startedActivity,
          timestamp: new Date().toISOString(),
        }, ...previous]);
        toast.success(startedActivity);

        setWorkflowBoard((previous) => {
          const runningNodes = previous.nodes.map((node, index) =>
            index === stepIndexToComplete
              ? { ...node, status: "in-progress" as const, stepStartTime: Date.now() }
              : node,
          );
          return { ...previous, nodes: runningNodes };
        });
      }

      // --- Trigger agent asynchronously ---
      const response = await fetch('/api/v2/migrations/run-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          migrationId: project.id,
          stepId: stepToRun.id,
          stepName: stepToRun.title,
          agentName: agentName,
          agentParams: agentParams,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start agent: ${errorText}`);
      }
      
      // The UI will now wait for realtime updates to reflect completion.
      // We no longer handle success/failure here.

    } catch (error) {
      console.error("Error progressing workflow:", error);
      const errorMessage = error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten";
      await appendActivity("error", `Fehler beim Fortschreiten des Workflows: ${errorMessage}`);
      
      // Revert UI state if something went wrong before the agent even started
      setIsStepRunning(false);
      onStepRunningChange?.(false);
    } finally {
      // Don't set isStepRunning to false here, as it's now a background task.
      // The UI state for this will be driven by the 'status' column from Supabase.
    }
  }, [
    workflowBoard,
    project.id,
    project.sourceSystem,
    project.targetSystem,
    project.sourceUrl,
    project.targetUrl,
    project.inConnectorDetail,
    project.outConnectorDetail,
    onRefresh,
    isStepRunning,
    ensureSystemDetectionRetryable,
    appendActivity,
    onStepRunningChange,
  ]);

  const handleAgentResultDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setAgentResultDialogStepId(null);
    }
  }, []);


  const normalizeActivity = useCallback((activity: RawActivityRecord): Activity => {
    const rawTimestamp = activity?.timestamp ?? activity?.created_at ?? "";

    let timestamp = "";
    if (typeof rawTimestamp === "string" && rawTimestamp.trim() !== "") {
      timestamp = rawTimestamp;
    } else if (rawTimestamp instanceof Date) {
      timestamp = rawTimestamp.toISOString();
    } else if (rawTimestamp) {
      const parsed = new Date(rawTimestamp);
      timestamp = Number.isNaN(parsed.getTime()) ? String(rawTimestamp) : parsed.toISOString();
    } else {
      timestamp = new Date().toISOString();
    }

    return {
      id: activity?.id ?? `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: (activity?.type ?? "info") as Activity["type"],
      title: activity?.title ?? "",
      timestamp,
    };
  }, []);

  const applyWorkflowState = useCallback(
    (rawState: unknown): boolean => {
      const parsedState = deserializeWorkflowState(rawState);
      if (!parsedState) {
        return false;
      }

      const normalized = normalizeWorkflowState(parsedState);
      setWorkflowBoard(normalized);
      cacheWorkflowStateSnapshot(project.id, normalized);
      return true;
    },
    [normalizeWorkflowState, project.id],
  );

  useEffect(() => {
    setNotes(project.notes ?? "");
    setStatus(project.status ?? "not_started");
    setActivityLog((project.activities ?? []).map(normalizeActivity));

    if (!applyWorkflowState(project.workflowState)) {
      const cachedState = loadCachedWorkflowState(project.id);
      if (cachedState) {
        setWorkflowBoard(normalizeWorkflowState(cachedState));
      } else {
        setWorkflowBoard(createDefaultWorkflowBoard());
      }
    }
  }, [
    project.activities,
    project.id,
    project.notes,
    project.status,
    project.workflowState,
    normalizeActivity,
    applyWorkflowState,
    normalizeWorkflowState,
  ]);

  useEffect(() => {
    let isCancelled = false;

    const fetchWorkflowState = async () => {
      try {
        const { data, error } = await supabaseDatabase.fetchMigrationById(project.id);

        if (error) {
          throw error;
        }

        if (!isCancelled) {
          if (data?.workflow_state && applyWorkflowState(data.workflow_state)) {
            return;
          }

          const cachedState = loadCachedWorkflowState(project.id);
          if (cachedState) {
            setWorkflowBoard(normalizeWorkflowState(cachedState));
          }
        }
      } catch (error) {
        console.error("Fehler beim Nachladen des Workflow-Status:", error);
      }
    };

    void fetchWorkflowState();

    return () => {
      isCancelled = true;
    };
  }, [project.id, applyWorkflowState, normalizeWorkflowState]);

  // Realtime subscription for migration updates - must be after applyWorkflowState/normalizeActivity definitions
  useEffect(() => {
    if (!project.id) return;

    const channel = supabase
      .channel(`migration-details:${project.id}`)
      .on<MigrationProject>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "migrations",
          filter: `id=eq.${project.id}`,
        },
        (payload) => {
          const newProject = payload.new;
          
          if (newProject.status && newProject.status !== status) {
            setStatus(newProject.status as MigrationStatus);
          }
          
          if (newProject.workflowState) {
            // A workflow state change from the backend means the agent step finished.
            setIsStepRunning(false);
            onStepRunningChange?.(false);
            applyWorkflowState(newProject.workflowState);
          }

          if(newProject.activities) {
            setActivityLog((newProject.activities as RawActivityRecord[] ?? []).map(normalizeActivity));
          }
          
          // As a fallback, refresh everything
          onRefresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id, status, onRefresh, applyWorkflowState, normalizeActivity, onStepRunningChange]);

  useEffect(() => {
    void ensureSystemDetectionRetryable(workflowBoard);
  }, [workflowBoard, ensureSystemDetectionRetryable]);

  useEffect(() => {
    const inProgressNode = workflowBoard.nodes.find((node) => node.status === "in-progress");

    if (!inProgressNode) {
      return;
    }
    
    const startTime = (inProgressNode as any).stepStartTime;
    if (!startTime) {
      return;
    }

    const elapsedTime = Date.now() - startTime;
    const remainingTime = STEP_TIMEOUT - elapsedTime;

    if (remainingTime <= 0) {
      setWorkflowBoard((previousBoard) => {
        const updatedNodes = previousBoard.nodes.map((node) => {
          if (node.id === inProgressNode.id) {
            return {
              ...node,
              status: "done" as const,
              agentResult: {
                error:
                  "Operation timed out. The backend service may be unavailable. Please try again later.",
              },
            };
          }
          return node;
        });
        const newState = { ...previousBoard, nodes: updatedNodes };
        cacheWorkflowStateSnapshot(project.id, newState);
        return newState;
      });

      setIsStepRunning(false);
      onStepRunningChange?.(false);
      appendActivity("error", `Schritt "${inProgressNode.title}" hat das Zeitlimit überschritten.`);
      toast.error(`Schritt "${inProgressNode.title}" hat das Zeitlimit überschritten.`);
      return;
    }

    const timeoutId = setTimeout(() => {
      setWorkflowBoard((previousBoard) => {
        const currentNode = previousBoard.nodes.find((n) => n.id === inProgressNode.id);

        if (currentNode && currentNode.status === "in-progress") {
          const updatedNodes = previousBoard.nodes.map((node) => {
            if (node.id === inProgressNode.id) {
              return {
                ...node,
                status: "done" as const,
                agentResult: {
                  error:
                    "Operation timed out. The backend service may be unavailable. Please try again later.",
                },
              };
            }
            return node;
          });
          const newState = { ...previousBoard, nodes: updatedNodes };
          cacheWorkflowStateSnapshot(project.id, newState);
          return newState;
        }
        return previousBoard;
      });

      setIsStepRunning(false);
      onStepRunningChange?.(false);
      appendActivity("error", `Schritt "${inProgressNode.title}" hat das Zeitlimit überschritten.`);
      toast.error(`Schritt "${inProgressNode.title}" hat das Zeitlimit überschritten.`);
    }, remainingTime);

    return () => clearTimeout(timeoutId);
  }, [workflowBoard, appendActivity, onStepRunningChange, project.id]);

  useEffect(() => {
    if (!project.id) {
      return;
    }

    const nodesWithResults = workflowBoard.nodes.filter((node) => nodeHasAgentResult(node));
    if (nodesWithResults.length === 0) {
      agentResultPersistenceSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify(
      nodesWithResults.map((node) => ({
        id: node.id,
        result: node.agentResult,
      })),
    );

    if (agentResultPersistenceSignatureRef.current === signature) {
      return;
    }

    agentResultPersistenceSignatureRef.current = signature;

    const persistAgentResults = async () => {
      const snapshot = serializeWorkflowState(workflowBoard);
      cacheWorkflowStateSnapshot(project.id, snapshot);

      try {
        await supabaseDatabase.updateMigration(project.id, { workflow_state: snapshot as any });
      } catch (error) {
        console.error("Fehler beim automatischen Speichern des Agenten-Outputs:", error);
      }
    };

    void persistAgentResults();
  }, [workflowBoard, project.id]);

  useEffect(() => {
    if (!isWorkflowPanelOpen) {
      setWorkflowPanelSelection(null);
    }
  }, [isWorkflowPanelOpen]);

  const isNotesDirty = useMemo(() => (project.notes ?? "") !== notes, [project.notes, notes]);

  const transferInfo = useMemo(() => parseProgressPair(project.objectsTransferred), [project.objectsTransferred]);
  const mappedInfo = useMemo(() => parseProgressPair(project.mappedObjects), [project.mappedObjects]);

  const identitySeed = `${project.id ?? ""}-${project.name ?? ""}-${project.sourceSystem ?? ""}`;
  const targetSeed = `${project.id ?? ""}-${project.targetSystem ?? ""}`;

  const sourceObjectEstimate = useMemo(() => {
    if (mappedInfo.total > 0) {
      return mappedInfo;
    }

    return simulateSourceObjects(identitySeed);
  }, [identitySeed, mappedInfo]);

  const targetObjectEstimate = useMemo(() => {
    if (transferInfo.total > 0) {
      return transferInfo;
    }

    return simulateTargetObjects(targetSeed, sourceObjectEstimate.total);
  }, [sourceObjectEstimate, targetSeed, transferInfo]);

  const overallProgress = Math.min(100, Math.max(0, Math.round(Number(project.progress) || 0)));
  const statusMeta = MIGRATION_STATUS_META[status];

  const agentWorkflowProgress = useMemo(() => {
    const nodes = workflowBoard.nodes;

    if (nodes.length === 0) {
      const fallbackStepCount = AGENT_WORKFLOW_STEPS.length;
      const normalizedProgress = Math.max(0, Math.min(100, overallProgress));
      const progressPerStep = fallbackStepCount > 0 ? 100 / fallbackStepCount : 0;
      const activeIndex =
        normalizedProgress >= 100 || progressPerStep === 0
          ? fallbackStepCount - 1
          : Math.floor(normalizedProgress / progressPerStep);

      const fallbackSteps: AgentWorkflowStepState[] = AGENT_WORKFLOW_STEPS.map((step, index) => {
        const startThreshold = progressPerStep * index;
        const endThreshold = progressPerStep * (index + 1);
        const isLastStep = index === fallbackStepCount - 1;
        const isCompleted = isLastStep ? normalizedProgress >= 100 : normalizedProgress >= endThreshold;
        const isActive = !isCompleted && index === activeIndex;
        const progressFraction = isCompleted
          ? 1
          : isActive && progressPerStep > 0
            ? Math.max(0, Math.min(1, (normalizedProgress - startThreshold) / progressPerStep))
            : 0;
        const status: AgentWorkflowStepState["status"] = isCompleted
          ? "completed"
          : isActive
            ? "active"
            : "upcoming";

        return {
          ...step,
          index,
          status,
          progress: progressFraction,
          startThreshold,
          endThreshold,
        };
      });

      const fallbackActiveStep =
        fallbackSteps.find((step) => step.status === "active") ??
        (normalizedProgress >= 100 ? fallbackSteps[fallbackSteps.length - 1] ?? null : fallbackSteps[0] ?? null);

      return {
        steps: fallbackSteps,
        activeStep: fallbackActiveStep,
        nextStep: fallbackSteps.find((step) => step.status === "upcoming") ?? null,
        completedCount: fallbackSteps.filter((step) => step.status === "completed").length,
        progressPerStep,
      };
    }

    const stepCount = nodes.length;
    const progressPerStep = stepCount > 0 ? 100 / stepCount : 0;
    const highlightInitialStep =
      status === "not_started" && nodes.length > 0 && nodes.every((node) => node.status === "pending");

    let steps = nodes.map((node, index) => {
      const defaultAgentStep = AGENT_WORKFLOW_STEPS.find((step) => step.id === node.id);
      const baseStep = defaultAgentStep ?? {
        id: node.id,
        title: node.title ?? `Schritt ${index + 1}`,
        description: node.description ?? "",
        phase: "",
        agentType: node.agentType ?? "",
        color: node.color ?? "sky",
      };

      let statusForStep: "completed" | "active" | "upcoming";

      if (node.status === "done") {
        statusForStep = "completed";
      } else if (node.status === "in-progress") {
        statusForStep = "active";
      } else if (highlightInitialStep && index === 0) {
        statusForStep = "active";
      } else {
        statusForStep = "upcoming";
      }

      const startThreshold = progressPerStep * index;
      const endThreshold = progressPerStep * (index + 1);

      let progressFraction = 0;
      if (statusForStep === "completed") {
        progressFraction = 1;
      } else if (statusForStep === "active") {
        if (stepProgress > 0) {
          progressFraction = Math.min(1, Math.max(0, stepProgress / 100));
        } else if (overallProgress >= endThreshold) {
          progressFraction = 1;
        } else if (overallProgress <= startThreshold) {
          progressFraction = 0;
        } else if (endThreshold - startThreshold > 0) {
          progressFraction = (overallProgress - startThreshold) / (endThreshold - startThreshold);
        }
      }

      return {
        ...baseStep,
        title: node.title ?? baseStep.title,
        description: node.description ?? baseStep.description,
        color: node.color ?? baseStep.color,
        agentType: node.agentType ?? baseStep.agentType,
        index,
        status: statusForStep,
        progress: Math.max(0, Math.min(1, progressFraction)),
        startThreshold,
        endThreshold,
      } as AgentWorkflowStepState;
    });

    const hasExplicitActiveStep = steps.some((step) => step.status === "active");
    const allStepsCompleted = steps.every((step) => step.status === "completed");

    if (!hasExplicitActiveStep && !allStepsCompleted) {
      const nextUpcomingIndex = steps.findIndex((step) => step.status === "upcoming");

      if (nextUpcomingIndex !== -1) {
        steps = steps.map((step, index) =>
          index === nextUpcomingIndex
            ? { ...step, status: "active" as const, progress: 0 }
            : step,
        );
      }
    }

    const activeStep =
      steps.find((step) => step.status === "active") ??
      (allStepsCompleted ? steps[steps.length - 1] ?? null : null);

    return {
      steps,
      activeStep,
      nextStep: steps.find((step) => step.status === "upcoming") ?? null,
      completedCount: steps.filter((step) => step.status === "completed").length,
      progressPerStep,
    };
  }, [workflowBoard.nodes, overallProgress, stepProgress, status]);

  const { steps: agentSteps, activeStep, nextStep, completedCount } = agentWorkflowProgress;
  const activeStepProgressPercent = Math.round((activeStep?.progress ?? 0) * 100);
  const activeColorTheme = getWorkflowTheme(activeStep?.color);

  // Check if the current active step has failed (has error in agentResult)
  const hasCurrentStepFailed = useMemo(() => {
    if (!activeStep) return false;
    
    const activeNode = workflowBoard.nodes.find(n => n.id === activeStep.id);
    if (!activeNode) return false;
    
    const result = activeNode.agentResult;
    if (!result || typeof result !== 'object') return false;
    
    return 'error' in (result as Record<string, unknown>);
  }, [activeStep, workflowBoard.nodes]);

  const workflowNodeMap = useMemo(() => {
    return workflowBoard.nodes.reduce<Record<string, WorkflowNode>>((accumulator, node) => {
      accumulator[node.id] = node;
      return accumulator;
    }, {});
  }, [workflowBoard.nodes]);

  const agentResultDialogNode = useMemo(() => {
    if (!agentResultDialogStepId) {
      return null;
    }

    return workflowNodeMap[agentResultDialogStepId] ?? null;
  }, [agentResultDialogStepId, workflowNodeMap]);

  const agentResultDialogStep = useMemo(() => {
    if (!agentResultDialogStepId) {
      return null;
    }

    return agentSteps.find((step) => step.id === agentResultDialogStepId) ?? null;
  }, [agentResultDialogStepId, agentSteps]);

  const {
    formatted: agentResultDialogFormatted,
    structuredResult: agentResultDialogStructured,
    rawOutput: agentResultDialogRawOutput,
  } = useMemo(() => {
    if (
      !agentResultDialogNode ||
      agentResultDialogNode.agentResult === undefined ||
      agentResultDialogNode.agentResult === null
    ) {
      return {
        formatted: null as string | null,
        rawOutput: null as string | null,
        structuredResult: null as
          | SystemDetectionResult
          | SystemDetectionStepResult
          | AuthFlowResult
          | AuthFlowStepResult
          | CapabilityDiscoveryResult
          | null,
      };
    }

    const result = agentResultDialogNode.agentResult;

    const normalizeByAgentType = (value: unknown) => {
      if (agentResultDialogNode.agentType === "system-detection") {
        return (
          normalizeSystemDetectionStepResult(value) ?? normalizeSystemDetectionResult(value)
        );
      }

      if (agentResultDialogNode.agentType === "auth-flow") {
        return normalizeAuthFlowStepResult(value) ?? normalizeAuthFlowResult(value);
      }

      if (agentResultDialogNode.agentType === "schema-discovery") {
        return normalizeCapabilityDiscoveryResult(value);
      }

      return (
        normalizeSystemDetectionStepResult(value) ??
        normalizeSystemDetectionResult(value) ??
        normalizeAuthFlowStepResult(value) ??
        normalizeAuthFlowResult(value) ??
        normalizeCapabilityDiscoveryResult(value)
      );
    };

    const normalizeWithFallbacks = (value: unknown):
      | SystemDetectionResult
      | SystemDetectionStepResult
      | AuthFlowResult
      | AuthFlowStepResult
      | CapabilityDiscoveryResult
      | null => {
      const normalized = normalizeByAgentType(value);
      if (normalized) {
        return normalized;
      }

      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return normalizeByAgentType(parsed);
        } catch (error) {
          return null;
        }
      }

      return null;
    };
    let extractedRawOutput: string | null = null;

    const normalizeRawOutput = (value: unknown, depth = 0): string | null => {
      if (value === null || value === undefined) {
        return null;
      }

      if (depth > 4) {
        return null;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();

        if (!trimmed) {
          return null;
        }

        const firstChar = trimmed[0];
        if (firstChar === "{" || firstChar === "[") {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "raw_output" in parsed) {
              return normalizeRawOutput((parsed as Record<string, unknown>).raw_output, depth + 1);
            }
          } catch (error) {
            // Ignore JSON parse errors and fall back to returning the trimmed string.
          }
        }

        return trimmed;
      }

      if (Array.isArray(value)) {
        const flattened = value
          .map((entry) => normalizeRawOutput(entry, depth + 1))
          .filter((entry): entry is string => Boolean(entry && entry.length > 0));

        return flattened.length > 0 ? flattened.join("\n") : null;
      }

      if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        if ("raw_output" in record) {
          return normalizeRawOutput(record.raw_output, depth + 1);
        }

        const lines = Object.entries(record)
          .map(([key, entry]) => {
            const normalized = normalizeRawOutput(entry, depth + 1);
            return normalized ? `${key}: ${normalized}` : null;
          })
          .filter((entry): entry is string => Boolean(entry && entry.length > 0));

        return lines.length > 0 ? lines.join("\n") : null;
      }

      return String(value);
    };

    const removeRawOutput = (input: unknown): unknown => {
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const { raw_output, ...rest } = input as Record<string, unknown>;
        const normalizedRawOutput = normalizeRawOutput(raw_output);
        if (normalizedRawOutput !== null) {
          extractedRawOutput = normalizedRawOutput;
        }
        return rest;
      }

      return input;
    };

    const hasStructuredContent = (value: unknown): boolean => {
      if (value === null || value === undefined) {
        return false;
      }

      if (typeof value === "string") {
        return value.trim().length > 0;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }

      return true;
    };

    const formatValue = (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    };

    if (typeof result === "string") {
      const trimmed = result.trim();

      if (!trimmed) {
        return {
          formatted: null,
          rawOutput: extractedRawOutput ?? normalizeRawOutput(result),
          structuredResult: normalizeWithFallbacks(result),
        };
      }

      try {
        const parsed = JSON.parse(trimmed);
        const sanitized = removeRawOutput(parsed);
        const normalizedResult =
          normalizeWithFallbacks(sanitized ?? parsed) ??
          normalizeWithFallbacks(parsed) ??
          normalizeWithFallbacks(extractedRawOutput);
        return {
          formatted: hasStructuredContent(sanitized) ? formatValue(sanitized) : null,
          rawOutput: extractedRawOutput,
          structuredResult: normalizedResult ?? null,
        };
      } catch (error) {
        return {
          formatted: trimmed,
          rawOutput: extractedRawOutput ?? normalizeRawOutput(result),
          structuredResult:
            normalizeWithFallbacks(result) ??
            normalizeWithFallbacks(extractedRawOutput) ??
            normalizeByAgentType(result) ??
            null,
        };
      }
    }

    const sanitized = removeRawOutput(result);
    const normalizedResult =
      normalizeWithFallbacks(sanitized ?? result) ??
      normalizeWithFallbacks(result) ??
      normalizeWithFallbacks(extractedRawOutput);

    return {
      formatted: hasStructuredContent(sanitized) ? formatValue(sanitized) : null,
      rawOutput: extractedRawOutput ?? normalizeRawOutput(result),
      structuredResult: normalizedResult ?? null,
    };
  }, [agentResultDialogNode]);

  const isCapabilityResult = (value: unknown): value is CapabilityDiscoveryResult => {
    return Boolean(
      value &&
      typeof value === "object" &&
      "objects" in (value as Record<string, unknown>),
    );
  };

  const agentDialogSourceResult = useMemo<
    SystemDetectionResult | AuthFlowResult | null
  >(() => {
    if (!agentResultDialogStructured || isCapabilityResult(agentResultDialogStructured)) {
      return null;
    }

    if (isStepStructuredResult(agentResultDialogStructured)) {
      return agentResultDialogStructured.source ?? null;
    }

    return agentResultDialogStructured as SystemDetectionResult | AuthFlowResult;
  }, [agentResultDialogStructured]);

  const agentDialogTargetResult = useMemo<
    SystemDetectionResult | AuthFlowResult | null
  >(() => {
    if (isCapabilityResult(agentResultDialogStructured)) {
      return null;
    }

    if (isStepStructuredResult(agentResultDialogStructured)) {
      return agentResultDialogStructured.target ?? null;
    }

    return null;
  }, [agentResultDialogStructured]);


  const schemaDiscoveryStepState = agentSteps.find((step) => step.id === "schema-discovery");
  const qualityEnhancementStepState = agentSteps.find((step) => step.id === "quality-enhancement");
  const verificationStepState = agentSteps.find((step) => step.id === "verification");

  const sourceTotalsVisible = schemaDiscoveryStepState
    ? overallProgress >= schemaDiscoveryStepState.endThreshold
    : false;
  const targetTotalsVisible = qualityEnhancementStepState ? overallProgress >= qualityEnhancementStepState.endThreshold : false;
  const finalCountsVisible = verificationStepState
    ? overallProgress >= verificationStepState.endThreshold
    : false;

  const computeDisplayPair = (
    totalsUnlocked: boolean,
    finalUnlocked: boolean,
    estimate: { current: number; total: number }
  ) => {
    if (!totalsUnlocked) {
      return "0/0";
    }

    const resolvedTotal = Math.max(estimate.total, estimate.current, 0);
    const resolvedCurrent = finalUnlocked ? resolvedTotal : 0;

    return formatProgressPair({ current: resolvedCurrent, total: resolvedTotal });
  };

  const sourceObjectsDisplay = computeDisplayPair(sourceTotalsVisible, finalCountsVisible, sourceObjectEstimate);
  const targetObjectsDisplay = computeDisplayPair(targetTotalsVisible, finalCountsVisible, targetObjectEstimate);

  const handleSaveNotes = async () => {
    if (!isNotesDirty) return;

    try {
      setIsSavingNotes(true);
      const { error } = await supabaseDatabase.updateMigration(project.id, { notes });

      if (error) throw error;

      toast.success("Anmerkungen gespeichert");
      await onRefresh();
    } catch (error) {
      console.error("Fehler beim Speichern der Anmerkungen:", error);
      await appendActivity("error", "Anmerkungen konnten nicht gespeichert werden");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleSendChatMessage = useCallback(
    async (message: string) => {
      // Benutzernachricht zum Activity-Log hinzufügen
      const userActivity: Activity = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "info",
        title: `[user] ${message}`,
        timestamp: new Date().toISOString(),
      };
      
      setActivityLog((prev) => [userActivity, ...prev]);
      
      // Auch in Datenbank speichern
      try {
        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: "info",
          title: `[user] ${message}`,
          timestamp: new Date().toISOString()
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
          activities={activityLog}
          isStepRunning={isStepRunning}
          stepProgress={stepProgress}
          activeStep={activeStep}
          completedCount={completedCount}
          totalSteps={agentSteps.length}
          overallProgress={overallProgress}
          status={status}
          sourceSystem={project.sourceSystem}
          targetSystem={project.targetSystem}
          sourceObjectsDisplay={sourceObjectsDisplay}
          targetObjectsDisplay={targetObjectsDisplay}
          hasCurrentStepFailed={hasCurrentStepFailed}
          onSendMessage={handleSendChatMessage}
          onContinue={handleNextWorkflowStep}
          onOpenAgentOutput={(stepId) => setAgentResultDialogStepId(stepId)}
        />
      </div>

      <AgentResultDialog
        open={agentResultDialogStepId !== null}
        onOpenChange={handleAgentResultDialogOpenChange}
        step={agentResultDialogStep}
        formattedResult={agentResultDialogFormatted}
        structuredResult={agentResultDialogStructured}
        sourceResult={agentDialogSourceResult}
        targetResult={agentDialogTargetResult}
        rawOutput={agentResultDialogRawOutput}
      />

      <WorkflowPanelDialog
        open={isWorkflowPanelOpen}
        onOpenChange={setIsWorkflowPanelOpen}
        workflow={workflowBoard}
        onWorkflowChange={handleWorkflowChange}
        initialSelectedNodeId={workflowPanelSelection}
      />
    </div>
  );
});

MigrationDetails.displayName = "MigrationDetails";

export default MigrationDetails;
