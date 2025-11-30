import { useCallback, useEffect, useMemo, useRef, useState, useId, forwardRef, useImperativeHandle } from "react";
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

const MigrationDetails = forwardRef<MigrationDetailsRef, MigrationDetailsProps>(({ project, onRefresh }, ref) => {
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
        toast.error("Status konnte nicht aktualisiert werden");
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [status, project.id],
  );

  const executeAgentForStep = useCallback(
    async (
      node: WorkflowNode,
      options?: { onProgress?: (value: number) => void },
    ): Promise<SystemDetectionStepResult | AuthFlowStepResult | CapabilityDiscoveryResult | undefined> => {
      if (!node.agentType || node.active === false) {
        return undefined;
      }

      const reportProgress = (value: number) => {
        if (options?.onProgress) {
          options.onProgress(clampProgressValue(value));
        }
      };

      if (node.agentType === "auth-flow") {
        const { data: connectorRows, error: connectorsError } = await supabaseDatabase.fetchConnectorsByMigration(project.id);

        if (connectorsError) {
          const message = connectorsError.message || "Konnektordaten konnten nicht geladen werden.";
          await appendActivity("error", message);
          toast.error(message);
          throw new AgentExecutionError(message);
        }

        const connectors = (connectorRows ?? []) as ConnectorRecord[];
        const sourceConnector = connectors.find((record) => record.connector_type === "in");
        const targetConnector = connectors.find((record) => record.connector_type === "out");
        const fallbackSourceBaseUrl = (project.sourceUrl ?? project.inConnectorDetail ?? "").trim();
        const fallbackTargetBaseUrl = (project.targetUrl ?? project.outConnectorDetail ?? "").trim();

        const resolveConnectorAuth = async (
          scope: "source" | "target",
          connector: ConnectorRecord | undefined,
          fallbackBaseUrl: string,
        ): Promise<AuthContext> => {
          const scopeLabel = scope === "source" ? "Quellsystem" : "Zielsystem";

          if (!connector) {
            const message = `Keine Connector-Konfiguration für das ${scopeLabel} vorhanden.`;
            await appendActivity("error", message);
            toast.error(message);
            throw new AgentExecutionError(message);
          }

          const baseUrl = (connector.api_url ?? fallbackBaseUrl ?? "").trim();
          if (!baseUrl) {
            const message = `Für das ${scopeLabel} ist keine API-URL hinterlegt.`;
            await appendActivity("error", message);
            toast.error(message);
            throw new AgentExecutionError(message);
          }
          const apiToken = (connector.api_key ?? "").trim();
          const email = (connector.username ?? "").trim();
          const password = connector.password ?? "";

          if (!apiToken) {
            const message = `Für das ${scopeLabel} wurde kein API-Token hinterlegt.`;
            await appendActivity("error", message);
            toast.error(message);
            throw new AgentExecutionError(message);
          }

          if (!email || !password) {
            const message = `Für das ${scopeLabel} fehlen E-Mail oder Passwort.`;
            await appendActivity("error", message);
            toast.error(message);
            throw new AgentExecutionError(message);
          }

          return { baseUrl, apiToken, email, password };
        };

        const sourceAuthContext = await resolveConnectorAuth("source", sourceConnector, fallbackSourceBaseUrl);
        const targetAuthContext = await resolveConnectorAuth("target", targetConnector, fallbackTargetBaseUrl);

        const runAuthForScope = async (
          scope: "source" | "target",
          system: string,
          auth: AuthContext,
        ): Promise<AuthFlowResult> => {
          const scopeLabel = scope === "source" ? "Quellsystem" : "Zielsystem";
          await appendActivity(
            "info",
            `Authentifizierung gestartet (${scopeLabel}): ${system}`,
          );

          try {
            // ✅ neues API: runAuthFlowAgent bekommt genau EIN Objekt
            const result = await runAuthFlowAgent({
              system,
              baseUrl: auth.baseUrl,
              apiToken: auth.apiToken,
              email: auth.email,
              password: auth.password,
            });

            const statusLabel = result.authenticated ? "erfolgreich" : "fehlgeschlagen";

            if (!result.authenticated) {
              // ✅ flexibel, egal ob das Resultat "error", "error_message", "summary" oder "reasoning" benutzt
              const raw = result as any;
              const errorMsg =
                raw.error ||
                raw.error_message ||
                raw.summary ||
                raw.reasoning ||
                "Authentifizierung fehlgeschlagen";

              await appendActivity(
                "error",
                `Authentifizierung ${statusLabel} (${scopeLabel}): ${system}`,
              );
              toast.error(`Authentifizierung fehlgeschlagen (${scopeLabel}): ${errorMsg}`);

              const errorPayload =
                scope === "source"
                  ? { source: result, error: errorMsg }
                  : { target: result, error: errorMsg };

              throw new AgentExecutionError(errorMsg, errorPayload);
            }

            await appendActivity(
              "success",
              `Authentifizierung ${statusLabel} (${scopeLabel}): ${system}`,
            );
            return result;

          } catch (error) {
            if (error instanceof AgentExecutionError) {
              throw error;
            }

            const message = error instanceof Error ? error.message : String(error);
            await appendActivity(
              "error",
              `Authentifizierung fehlgeschlagen (${scopeLabel}): ${system}`,
            );
            toast.error(`Authentifizierung fehlgeschlagen (${scopeLabel}): ${message}`);

            const errorPayload =
              scope === "source" ? { error: message } : { error: message };

            throw new AgentExecutionError(message, errorPayload);
          }
        };


        let sourceAuth: AuthFlowResult | null = null;
        let targetAuth: AuthFlowResult | null = null;

        try {
          reportProgress(25);
          sourceAuth = await runAuthForScope("source", project.sourceSystem, sourceAuthContext);

          reportProgress(75);
          targetAuth = await runAuthForScope("target", project.targetSystem, targetAuthContext);

          reportProgress(100);
          return { source: sourceAuth, target: targetAuth };
        } catch (error) {
          if (error instanceof AgentExecutionError) {
            const combinedPayload: Record<string, unknown> = {
              ...(sourceAuth ? { source: sourceAuth } : {}),
              ...(targetAuth ? { target: targetAuth } : {}),
            };

            if (error.agentResult && typeof error.agentResult === "object" && !Array.isArray(error.agentResult)) {
              Object.assign(combinedPayload, error.agentResult as Record<string, unknown>);
            }

            if (!("error" in combinedPayload)) {
              combinedPayload.error = error.message;
            }

            throw new AgentExecutionError(error.message, Object.keys(combinedPayload).length > 0 ? combinedPayload : undefined);
          }

          const message = error instanceof Error ? error.message : String(error);
          throw new AgentExecutionError(message, { error: message });
        }
      }

      if (node.agentType === "system-detection") {
        const sourceBaseUrl = (project.sourceUrl ?? project.inConnectorDetail ?? "").trim();

        const runDetectionForScope = async (
          scope: "source" | "target",
          baseUrl: string,
          expectedSystem?: string | null,
          completionProgress?: number,
        ): Promise<SystemDetectionResult> => {
          const scopeLabel = scope === "source" ? "Quellsystem" : "Zielsystem";
          await appendActivity("info", `Systemerkennung gestartet (${scopeLabel}): ${expectedSystem || baseUrl}`);

          try {
            const rawDetection = await runSystemDetectionAgent(baseUrl, expectedSystem || undefined);
            const detection = normalizeSystemDetectionResult(rawDetection);

            if (!detection) {
              const errorMessage = "Ungültige Systemerkennungs-Antwort erhalten.";
              throw new AgentExecutionError(errorMessage, {
                [`${scope}RawDetection`]: rawDetection,
              });
            }

            const hasApiSubtype = typeof detection.apiSubtype === "string" && detection.apiSubtype.trim().length > 0;
            const normalizedConfidence = confidenceToPercent(detection.confidenceScore);
            const summaryParts = [
              hasApiSubtype ? detection.apiSubtype : detection.apiTypeDetected ?? "Unbekannter Typ",
              detection.recommendedBaseUrl,
              normalizedConfidence !== null ? `Confidence ${normalizedConfidence}%` : null,
            ].filter(Boolean);

            const statusLabel = detection.systemMatchesUrl ? "erfolgreich" : "unvollständig";
            const titleParts = [
              `Systemerkennung ${statusLabel} (${scopeLabel})`,
              summaryParts.join(" · ") || baseUrl,
            ].filter(Boolean);

            if (!detection.systemMatchesUrl) {
              const failureMessage =
                `Die Systemerkennung (${scopeLabel}) konnte keine sichere Übereinstimmung der URL mit dem erwarteten System herstellen.`;
              await appendActivity("warning", titleParts.join(" · ") || failureMessage);
              toast.error(`Systemerkennung unvollständig (${scopeLabel}): URL passt nicht sicher.`);
              const errorPayload =
                scope === "source"
                  ? { source: detection, error: failureMessage }
                  : { target: detection, error: failureMessage };
              throw new AgentExecutionError(failureMessage, errorPayload);
            }

            await appendActivity("success", titleParts.join(" · "));

            if (typeof completionProgress === "number") {
              reportProgress(completionProgress);
            }

            return detection;
          } catch (error) {
            if (error instanceof AgentExecutionError) {
              throw error;
            }

            const message = error instanceof Error ? error.message : String(error);
            await appendActivity("error", `Systemerkennung fehlgeschlagen (${scopeLabel}): ${message}`);
            toast.error(`Systemerkennung fehlgeschlagen (${scopeLabel}): ${message}`);
            const errorPayload = scope === "source" ? { error: message } : { error: message };
            throw new AgentExecutionError(message, errorPayload);
          }
        };

        const toAgentError = (error: unknown, fallbackMessage: string) => {
          if (error instanceof AgentExecutionError) {
            return error;
          }
          const resolvedMessage = error instanceof Error ? error.message : fallbackMessage;
          return new AgentExecutionError(resolvedMessage, { error: resolvedMessage });
        };

        const mergeAgentErrorPayload = (
          payload: Record<string, unknown>,
          scope: "source" | "target",
          agentError: AgentExecutionError | null,
        ) => {
          if (!agentError) {
            return;
          }

          if (agentError.agentResult && typeof agentError.agentResult === "object" && !Array.isArray(agentError.agentResult)) {
            Object.assign(payload, agentError.agentResult as Record<string, unknown>);
          } else if (agentError.message) {
            payload[`${scope}Error`] = agentError.message;
          }
        };

        let sourceDetection: SystemDetectionResult | null = null;
        let sourceError: AgentExecutionError | null = null;

        if (!sourceBaseUrl) {
          const message = "Für die Systemerkennung des Quellsystems ist keine API-URL hinterlegt.";
          toast.error(message);
          await appendActivity("error", message);
          sourceError = new AgentExecutionError(message);
        } else {
          try {
            sourceDetection = await runDetectionForScope("source", sourceBaseUrl, project.sourceSystem, 50);
          } catch (error) {
            sourceError = toAgentError(error, "Systemerkennung fehlgeschlagen (Quellsystem).");
          }
        }

        const targetBaseUrl = (project.targetUrl ?? project.outConnectorDetail ?? "").trim();
        let targetDetection: SystemDetectionResult | null = null;
        let targetError: AgentExecutionError | null = null;

        if (!targetBaseUrl) {
          reportProgress(50);
          const message = "Für die Systemerkennung des Zielsystems ist keine API-URL hinterlegt.";
          await appendActivity("error", message);
          toast.error(message);
          targetError = new AgentExecutionError(message);
        } else {
          try {
            targetDetection = await runDetectionForScope("target", targetBaseUrl, project.targetSystem, 100);
          } catch (error) {
            targetError = toAgentError(error, "Systemerkennung fehlgeschlagen (Zielsystem).");
          }
        }

        if (!sourceDetection || !targetDetection) {
          const combinedPayload: Record<string, unknown> = {};
          if (sourceDetection) {
            combinedPayload.source = sourceDetection;
          }
          if (targetDetection) {
            combinedPayload.target = targetDetection;
          }

          mergeAgentErrorPayload(combinedPayload, "source", sourceError);
          mergeAgentErrorPayload(combinedPayload, "target", targetError);

          const message =
            sourceError?.message ||
            targetError?.message ||
            "Systemerkennung fehlgeschlagen: Bitte Eingaben prüfen und erneut versuchen.";

          throw new AgentExecutionError(message, Object.keys(combinedPayload).length > 0 ? combinedPayload : undefined);
        }

        toast.success("Systemerkennung für Quelle und Ziel abgeschlossen");
        return { source: sourceDetection, target: targetDetection };
      }

      if (node.agentType === "schema-discovery") {
        const { data: connectorRows, error: connectorsError } = await supabaseDatabase.fetchConnectorsByMigration(project.id);

        if (connectorsError) {
          const message = connectorsError.message || "Konnektordaten konnten nicht geladen werden.";
          await appendActivity("error", message);
          toast.error(message);
          throw new AgentExecutionError(message);
        }

        const connectors = (connectorRows ?? []) as ConnectorRecord[];
        const sourceConnector = connectors.find((record) => record.connector_type === "in");
        const baseUrl = (project.sourceUrl ?? project.inConnectorDetail ?? sourceConnector?.api_url ?? "").trim();
        const apiToken = (sourceConnector?.api_key ?? "").trim();
        const email = (sourceConnector?.username ?? "").trim();
        const password = (sourceConnector?.password ?? "").trim();

        if (!baseUrl) {
          const message = "Für das Quellsystem ist keine Basis-URL hinterlegt. Capability Discovery nicht möglich.";
          await appendActivity("error", message);
          toast.error(message);
          throw new AgentExecutionError(message);
        }

        if (!apiToken) {
          const message = "Für das Quellsystem wurde kein API-Token gefunden. Capability Discovery nicht möglich.";
          await appendActivity("error", message);
          toast.error(message);
          throw new AgentExecutionError(message);
        }

        await appendActivity("info", `Capability Discovery gestartet (Quelle): ${project.sourceSystem || baseUrl}`);
        reportProgress(20);

        const discoveryResult = await runCapabilityDiscoveryAgent(
          baseUrl,
          project.sourceSystem,
          apiToken,
          email,
          password,
        );
        reportProgress(90);

        await appendActivity("success", "Capability Discovery abgeschlossen");
        toast.success("Capability Discovery abgeschlossen");

        reportProgress(100);
        return discoveryResult;
      }

      return undefined;
    },
    [
      appendActivity,
      project.id,
      project.inConnectorDetail,
      project.outConnectorDetail,
      project.sourceUrl,
      project.targetUrl,
      project.sourceSystem,
      project.targetSystem,
    ],
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

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // Reset progress to 0 at the start of a new step
      setStepProgress(0);
      setIsStepRunning(true);

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

      const completedStepNode = nodesSnapshot[stepIndexToComplete];
      const isSystemDetectionStep = completedStepNode.id === "system-detection";

      const revertActiveNodeToPending = async (agentResultPayload?: unknown) => {
        let nextWorkflowState: WorkflowBoardState | null = null;

        setWorkflowBoard((previous) => {
          const updatedNodes = previous.nodes.map((node, index) => {
            if (index !== stepIndexToComplete) {
              return node;
            }

            const nextStatus = node.status === "done" ? node.status : ("pending" as const);

            return {
              ...node,
              status: nextStatus,
              agentResult: agentResultPayload ?? node.agentResult,
            };
          });

          nextWorkflowState = {
            ...previous,
            nodes: updatedNodes,
          };

          return nextWorkflowState;
        });

        if (nextWorkflowState) {
          cacheWorkflowStateSnapshot(project.id, nextWorkflowState);
          try {
            await supabaseDatabase.updateMigration(project.id, {
              workflow_state: serializeWorkflowState(nextWorkflowState) as any,
            });
          } catch (error) {
            console.error("Fehler beim Speichern des Agenten-Outputs:", error);
          }

          await onRefresh();
        }
      };

      if (!isSystemDetectionStep) {
        // Animate progress from 0 to 100 over 2 seconds for non-detection steps
        const animationDuration = 2000;
        const animationSteps = 60;
        const stepIncrement = 100 / animationSteps;
        const stepInterval = animationDuration / animationSteps;

        let currentProgress = 0;
        progressInterval = setInterval(() => {
          currentProgress += stepIncrement;
          if (currentProgress >= 100) {
            setStepProgress(100);
            if (progressInterval) {
              clearInterval(progressInterval);
              progressInterval = null;
            }
          } else {
            setStepProgress(currentProgress);
          }
        }, stepInterval);

        await new Promise((resolve) => setTimeout(resolve, animationDuration + 100));

        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
          setStepProgress(100);
        }
      }

      setIsUpdatingStatus(true);

      if (activeStepIndex === -1) {
        const startedActivity = `Schritt gestartet: ${completedStepNode.title}`;

        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: "info",
          title: startedActivity,
          timestamp: new Date().toISOString()
        });

        setActivityLog((previous) => [
          {
            id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "info",
            title: startedActivity,
            timestamp: new Date().toISOString(),
          },
          ...previous,
        ]);
        toast.success(startedActivity);

        setWorkflowBoard((previous) => {
          const runningNodes = previous.nodes.map((node, index) => {
            if (index === stepIndexToComplete) {
              return { ...node, status: "in-progress" as const };
            }
            return node;
          });

          return { ...previous, nodes: runningNodes };
        });
      }

      let completedAgentResult: SystemDetectionStepResult | AuthFlowStepResult | CapabilityDiscoveryResult | undefined;
      try {
        completedAgentResult = await executeAgentForStep(completedStepNode, {
          onProgress: isSystemDetectionStep
            ? (value) => setStepProgress(clampProgressValue(value))
            : undefined,
        });

        // Debug: Log the completed agent result
        console.log(`[DEBUG] Completed agent result for step "${completedStepNode.id}":`, JSON.stringify(completedAgentResult, null, 2));
      } catch (error) {
        if (error instanceof AgentExecutionError) {
          const derivedAgentResult = (() => {
            if (error.agentResult === undefined) {
              return error.message;
            }

            if (
              error.agentResult &&
              typeof error.agentResult === "object" &&
              !Array.isArray(error.agentResult)
            ) {
              const resultRecord = error.agentResult as Record<string, unknown>;
              if (typeof resultRecord.error === "string" && resultRecord.error.trim().length > 0) {
                return { ...resultRecord };
              }
              return { ...resultRecord, error: error.message };
            }

            return error.agentResult;
          })();

          await revertActiveNodeToPending(derivedAgentResult);
          await createViewResultActivity(completedStepNode, true);
          setAgentResultDialogStepId(completedStepNode.id);
          return;
        }
        throw error;
      }

      // Validate system detection result if this is the system-detection step
      if (completedStepNode.id === "system-detection" && completedAgentResult && "source" in completedAgentResult) {
        const isSystemDetectionResult = (result: any): result is SystemDetectionResult => {
          return result && typeof result === "object" && "systemMatchesUrl" in result;
        };

        const sourceDetection = completedAgentResult.source;
        const targetDetection = completedAgentResult.target;

        if (!sourceDetection || !isSystemDetectionResult(sourceDetection) || !sourceDetection.systemMatchesUrl) {
          const errorMsg =
            "Systemerkennung fehlgeschlagen: Es konnte kein Quellsystem hinter der URL erkannt werden.";
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          await createViewResultActivity(completedStepNode, true);
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const expectedSourceSystem = project.sourceSystem?.toLowerCase().trim();
        const detectedSourceSystem = sourceDetection.apiSubtype?.toLowerCase().trim();

        if (
          !detectedSourceSystem ||
          !expectedSourceSystem ||
          !detectedSourceSystem.includes(expectedSourceSystem.split(" ")[0])
        ) {
          const errorMsg = `Systemerkennung fehlgeschlagen: Erkannter Subtyp "${sourceDetection.apiSubtype}" stimmt nicht mit dem erwarteten Quellsystem "${project.sourceSystem}" überein.`;
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          await createViewResultActivity(completedStepNode, true);
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const sourceConfidence = confidenceToPercent(sourceDetection.confidenceScore);
        await appendActivity(
          "success",
          `Quellsystem erfolgreich erkannt: ${sourceDetection.apiSubtype ?? sourceDetection.apiTypeDetected} (Konfidenz: ${sourceConfidence ?? 0}%)`,
        );

        if (!targetDetection || !isSystemDetectionResult(targetDetection) || !targetDetection.systemMatchesUrl) {
          const errorMsg =
            "Systemerkennung fehlgeschlagen: Es konnte kein Zielsystem hinter der URL erkannt werden.";
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          await createViewResultActivity(completedStepNode, true);
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const expectedTargetSystem = project.targetSystem?.toLowerCase().trim();
        const detectedTargetSystem = targetDetection.apiSubtype?.toLowerCase().trim();

        if (
          !detectedTargetSystem ||
          !expectedTargetSystem ||
          !detectedTargetSystem.includes(expectedTargetSystem.split(" ")[0])
        ) {
          const errorMsg = `Systemerkennung fehlgeschlagen: Erkannter Subtyp "${targetDetection.apiSubtype}" stimmt nicht mit dem erwarteten Zielsystem "${project.targetSystem}" überein.`;
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          await createViewResultActivity(completedStepNode, true);
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const targetConfidence = confidenceToPercent(targetDetection.confidenceScore);
        await appendActivity(
          "success",
          `Zielsystem erfolgreich erkannt: ${targetDetection.apiSubtype ?? targetDetection.apiTypeDetected} (Konfidenz: ${targetConfidence ?? 0}%)`,
        );

        setStepProgress(100);
      }

      // Mark current step as done (but don't activate next step yet)
      const completedStepTitle = completedStepNode.title;
      const completedActivity = `Schritt abgeschlossen: ${completedStepTitle}`;

      // Save completed step activity to database
      await supabaseDatabase.insertMigrationActivity({
        migration_id: project.id,
        type: "success",
        title: completedActivity,
        timestamp: new Date().toISOString()
      });

      setActivityLog((previous) => [
        {
          id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "success",
          title: completedActivity,
          timestamp: new Date().toISOString(),
        },
        ...previous,
      ]);

      // Display agent's readable output in chat (if available)
      const readableOutput = extractAgentReadableOutput(completedAgentResult);
      if (readableOutput && readableOutput.trim().length > 0) {
        const agentResponseTimestamp = new Date().toISOString();
        
        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: "info",
          title: readableOutput,
          timestamp: agentResponseTimestamp
        });
        
        setActivityLog((previous) => [
          {
            id: `agent-response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "info",
            title: readableOutput,
            timestamp: agentResponseTimestamp,
          },
          ...previous,
        ]);
      }

      // Add activity with inline icon to open agent output
      await createViewResultActivity(completedStepNode, false);

      const updatedNodes = nodesSnapshot.map((node, idx) => {
        if (idx === stepIndexToComplete) {
          const updatedNode = {
            ...node,
            status: "done" as const,
            agentResult: completedAgentResult ?? node.agentResult,
          };

          // Debug: Log what will be persisted
          console.log(`[DEBUG] Updating node "${node.id}" with agentResult:`, JSON.stringify(updatedNode.agentResult, null, 2));

          return updatedNode;
        }
        return node;
      });

      const completedCount = updatedNodes.filter((node) => node.status === "done").length;
      const stepCount = updatedNodes.length;
      const normalizedProgress = stepCount > 0 ? Math.round((completedCount / stepCount) * 100) : 0;
      const clampedProgress = Math.max(0, Math.min(100, normalizedProgress));
      const isCompleted = completedCount >= stepCount && stepCount > 0;

      const nextWorkflowState: WorkflowBoardState = {
        ...boardForExecution,
        nodes: updatedNodes,
      };

      setWorkflowBoard(nextWorkflowState);
      cacheWorkflowStateSnapshot(project.id, nextWorkflowState);

      // Debug: Log workflow state before persisting
      const serializedState = serializeWorkflowState(nextWorkflowState);
      console.log(`[DEBUG] Persisting workflow state:`, JSON.stringify(serializedState, null, 2));

      const { error } = await supabaseDatabase.updateMigration(project.id, {
        progress: isCompleted ? 100 : clampedProgress,
        status: isCompleted ? "completed" : "running",
        workflow_state: serializedState as any
      });

      if (error) throw error;

      // Check if all steps are completed
      if (isCompleted) {
        const finalActivity = "Alle Schritte abgeschlossen";

        // Save final activity to database
        await supabaseDatabase.insertMigrationActivity({
          migration_id: project.id,
          type: "success",
          title: finalActivity,
          timestamp: new Date().toISOString()
        });

        setActivityLog((previous) => [
          {
            id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "success",
            title: finalActivity,
            timestamp: new Date().toISOString(),
          },
          ...previous,
        ]);
        toast.success(finalActivity);
      }

      if (isCompleted) {
        setStatus("completed");
      } else {
        setStatus("running");
      }

      await onRefresh();
    } catch (error) {
      console.error("Error progressing workflow:", error);
      toast.error("Fehler beim Fortschreiten des Workflows");
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      setIsUpdatingStatus(false);
      setIsStepRunning(false);
      // Keep stepProgress at 100 until next step starts
    }
  }, [
    workflowBoard,
    project.id,
    project.sourceSystem,
    project.targetSystem,
    onRefresh,
    isStepRunning,
    executeAgentForStep,
    ensureSystemDetectionRetryable,
    appendActivity,
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

  useEffect(() => {
    void ensureSystemDetectionRetryable(workflowBoard);
  }, [workflowBoard, ensureSystemDetectionRetryable]);

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
      toast.error("Anmerkungen konnten nicht gespeichert werden");
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
