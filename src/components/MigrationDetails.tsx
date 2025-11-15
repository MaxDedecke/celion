import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  PauseCircle,
  Pencil,
  Play,
  SquareArrowOutUpRight,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import CircularProgress from "./CircularProgress";
import ActivityTimeline, { Activity } from "./ActivityTimeline";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import WorkflowPanelDialog from "./dialogs/WorkflowPanelDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkflowBoardState, WorkflowNode } from "@/types/workflow";
import type { MigrationStatus } from "@/types/migration";
import type { SystemDetectionResult, SystemDetectionStepResult } from "@/types/agents";
import { runSystemDetectionAgent } from "@/lib/agentService";
import { cn } from "@/lib/utils";
import SystemDetectionOverview from "./SystemDetectionOverview";
import AgentOutputDisplay from "./AgentOutputDisplay";

interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  sourceSystem: string;
  targetSystem: string;
  sourceUrl?: string | null;
  targetUrl?: string | null;
  objectsTransferred: string;
  mappedObjects: string;
  projectId?: string;
  activities: Activity[];
  notes?: string;
  status: MigrationStatus;
  workflowState?: any;
  inConnectorDetail?: string | null;
  outConnectorDetail?: string | null;
}

interface MigrationDetailsProps {
  project: MigrationProject;
  onRefresh: () => Promise<void>;
}

const PROGRESS_STAGES: Array<{ label: string; threshold: number }> = [
  { label: "Planung abgeschlossen", threshold: 10 },
  { label: "Migration gestartet", threshold: 40 },
  { label: "Validierung läuft", threshold: 70 },
  { label: "Go-live vorbereitet", threshold: 100 },
];

const MIGRATION_STATUS_META: Record<MigrationStatus, { label: string; description: string; badgeClassName: string }> = {
  not_started: {
    label: "Bereit zum Start",
    description: "Alles vorbereitet – du kannst die Migration mit einem Klick starten.",
    badgeClassName: "bg-muted text-muted-foreground",
  },
  running: {
    label: "Laufend",
    description: "Die Migration verarbeitet gerade Daten. Du kannst den Fortschritt hier entspannt verfolgen.",
    badgeClassName: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  paused: {
    label: "Pausiert",
    description: "Der Prozess ruht. Starte ihn erneut, sobald alle offenen Fragen geklärt sind.",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  completed: {
    label: "Abgeschlossen",
    description: "Die Migration ist erfolgreich beendet. Nutze die Notizen, um Learnings festzuhalten.",
    badgeClassName: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
};

const MIGRATION_STATUS_FLOW = ["not_started", "running", "completed"] as const;
type StatusFlowStep = typeof MIGRATION_STATUS_FLOW[number];

const WORKFLOW_COLOR_THEME = {
  sky: {
    gradient: "from-sky-500/40 via-sky-500/10 to-transparent",
    accentText: "text-sky-600 dark:text-sky-300",
    accentBadge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    progressBar: "bg-sky-500",
    activeCard: "border-sky-500/50 bg-sky-500/10",
  },
  violet: {
    gradient: "from-violet-500/40 via-violet-500/10 to-transparent",
    accentText: "text-violet-600 dark:text-violet-300",
    accentBadge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    progressBar: "bg-violet-500",
    activeCard: "border-violet-500/50 bg-violet-500/10",
  },
  emerald: {
    gradient: "from-emerald-500/40 via-emerald-500/10 to-transparent",
    accentText: "text-emerald-600 dark:text-emerald-300",
    accentBadge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    progressBar: "bg-emerald-500",
    activeCard: "border-emerald-500/50 bg-emerald-500/10",
  },
  amber: {
    gradient: "from-amber-500/40 via-amber-500/10 to-transparent",
    accentText: "text-amber-600 dark:text-amber-300",
    accentBadge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    progressBar: "bg-amber-500",
    activeCard: "border-amber-500/50 bg-amber-500/10",
  },
  rose: {
    gradient: "from-rose-500/40 via-rose-500/10 to-transparent",
    accentText: "text-rose-600 dark:text-rose-300",
    accentBadge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    progressBar: "bg-rose-500",
    activeCard: "border-rose-500/50 bg-rose-500/10",
  },
} as const;

type WorkflowThemeKey = keyof typeof WORKFLOW_COLOR_THEME;

const getWorkflowTheme = (color?: string) => {
  if (!color) {
    return WORKFLOW_COLOR_THEME.sky;
  }

  return WORKFLOW_COLOR_THEME[(color as WorkflowThemeKey) ?? "sky"] ?? WORKFLOW_COLOR_THEME.sky;
};

const parseProgressPair = (value: string) => {
  const [current, total] = value.split("/").map((part) => Number(part) || 0);
  return { current, total };
};

const formatProgressPair = (pair: { current: number; total: number }) => `${pair.current}/${pair.total}`;

const sumCharCodes = (value: string) =>
  value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);

const createDefaultWorkflowBoard = (): WorkflowBoardState => {
  const nodes = AGENT_WORKFLOW_STEPS.map((step, index) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    x: 80 + (index % 3) * 280,
    y: 80 + Math.floor(index / 3) * 180,
    color: step.color,
    status: "pending" as const,
    priority: index + 1,
    active: true,
    agentType: step.agentType,
    agentPrompt: "",
    agentResult: undefined,
  }));

  const connections = nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    sourceId: node.id,
    targetId: nodes[index + 1].id,
  }));

  return { nodes, connections };
};

const nodeHasAgentResult = (node?: WorkflowNode | null): boolean => {
  if (!node) {
    return false;
  }

  if (node.agentResult === undefined || node.agentResult === null) {
    return false;
  }

  if (typeof node.agentResult === "string") {
    return node.agentResult.trim().length > 0;
  }

  return true;
};

const serializeWorkflowState = (state: WorkflowBoardState): WorkflowBoardState => ({
  nodes: state.nodes.map((node) => ({ ...node })),
  connections: state.connections.map((connection) => ({ ...connection })),
});

const deserializeWorkflowState = (payload: unknown): WorkflowBoardState | null => {
  if (!payload) {
    return null;
  }

  try {
    if (typeof payload === "string") {
      const parsed = JSON.parse(payload);
      return deserializeWorkflowState(parsed);
    }

    if (typeof payload !== "object") {
      return null;
    }

    const record = payload as Partial<WorkflowBoardState> & { nodes?: unknown; connections?: unknown };
    if (!Array.isArray(record.nodes)) {
      return null;
    }

    return {
      nodes: record.nodes as WorkflowBoardState["nodes"],
      connections: Array.isArray(record.connections)
        ? (record.connections as WorkflowBoardState["connections"])
        : [],
    };
  } catch (error) {
    console.error("Fehler beim Deserialisieren des Workflow-Status:", error);
    return null;
  }
};

const WORKFLOW_STATE_CACHE_PREFIX = "celion.workflow-state";

const getWorkflowStateCacheKey = (migrationId?: string | null) => {
  if (!migrationId) {
    return null;
  }
  return `${WORKFLOW_STATE_CACHE_PREFIX}:${migrationId}`;
};

const cacheWorkflowStateSnapshot = (migrationId: string | null | undefined, state: WorkflowBoardState) => {
  if (typeof window === "undefined") {
    return;
  }

  const cacheKey = getWorkflowStateCacheKey(migrationId);
  if (!cacheKey) {
    return;
  }

  try {
    const snapshot = serializeWorkflowState(state);
    window.localStorage.setItem(cacheKey, JSON.stringify(snapshot));
  } catch (error) {
    console.error("Fehler beim Zwischenspeichern des Workflow-Status:", error);
  }
};

const loadCachedWorkflowState = (migrationId: string | null | undefined): WorkflowBoardState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const cacheKey = getWorkflowStateCacheKey(migrationId);
  if (!cacheKey) {
    return null;
  }

  try {
    const cached = window.localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }

    return deserializeWorkflowState(cached);
  } catch (error) {
    console.error("Fehler beim Laden des zwischengespeicherten Workflow-Status:", error);
    return null;
  }
};

const simulateSourceObjects = (seed: string) => {
  const safeSeed = seed.trim() ? seed : "celion";
  const sum = sumCharCodes(safeSeed);
  const total = 180 + (sum % 420);
  return { current: total, total };
};

const simulateTargetObjects = (seed: string, sourceTotal: number) => {
  if (sourceTotal <= 0) {
    return { current: 0, total: 0 };
  }

  const safeSeed = seed.trim() ? seed : "celion-target";
  const sum = sumCharCodes(safeSeed);
  const minimumCompletion = Math.floor(sourceTotal * 0.6);
  const variabilityWindow = Math.max(1, Math.floor(sourceTotal * 0.25));
  const deduction = sum % variabilityWindow;
  const current = Math.max(minimumCompletion, sourceTotal - deduction);

  return { current: Math.min(current, sourceTotal), total: sourceTotal };
};

const clampProgressValue = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
};

const normalizeSystemDetectionResult = (input: unknown): SystemDetectionResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeSystemDetectionResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Partial<SystemDetectionResult>;
  if (typeof candidate.detected !== "boolean") {
    return null;
  }

  const evidence =
    candidate.detection_evidence && typeof candidate.detection_evidence === "object"
      ? (candidate.detection_evidence as SystemDetectionResult["detection_evidence"])
      : {};

  let confidence: number | null = null;
  if (typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)) {
    confidence = candidate.confidence;
  } else if (typeof candidate.confidence === "string") {
    const parsed = Number.parseFloat(candidate.confidence);
    confidence = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    detected: candidate.detected,
    system: candidate.system ?? null,
    api_version: candidate.api_version ?? null,
    confidence,
    base_url: candidate.base_url ?? null,
    detection_evidence: evidence,
    raw_output: candidate.raw_output ?? "",
  };
};

const normalizeSystemDetectionStepResult = (input: unknown): SystemDetectionStepResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeSystemDetectionStepResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const source = normalizeSystemDetectionResult(record.source);
  const target = normalizeSystemDetectionResult(record.target);

  if (!source && !target) {
    return null;
  }

  return { source, target };
};

const detectionMatchesExpectedSystem = (
  detection: SystemDetectionResult | null,
  expectedSystem?: string | null,
): boolean => {
  if (!detection || !detection.detected) {
    return false;
  }

  if (!expectedSystem) {
    return true;
  }

  if (!detection.system) {
    return false;
  }

  const normalizedDetected = detection.system.toLowerCase().trim();
  const normalizedExpected = expectedSystem.toLowerCase().trim();

  if (!normalizedDetected) {
    return false;
  }

  if (!normalizedExpected) {
    return true;
  }

  const expectedKeyword = normalizedExpected.split(" ")[0];
  if (!expectedKeyword) {
    return true;
  }

  return normalizedDetected.includes(expectedKeyword);
};

const hasSuccessfulSystemDetectionResult = (
  result: WorkflowNode["agentResult"],
  expectedSource?: string | null,
  expectedTarget?: string | null,
): boolean => {
  const combined = normalizeSystemDetectionStepResult(result);

  if (!combined?.source || !combined.target) {
    return false;
  }

  return (
    detectionMatchesExpectedSystem(combined.source, expectedSource) &&
    detectionMatchesExpectedSystem(combined.target, expectedTarget)
  );
};

const confidenceToPercent = (confidence: number | null): number | null => {
  if (confidence === null || !Number.isFinite(confidence)) {
    return null;
  }

  const value = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(value);
};

type AgentWorkflowStepState = (typeof AGENT_WORKFLOW_STEPS)[number] & {
  index: number;
  status: "completed" | "active" | "upcoming";
  progress: number;
  startThreshold: number;
  endThreshold: number;
};

type RawActivityRecord = {
  id?: string;
  type?: Activity["type"];
  title?: string;
  timestamp?: string | Date | null;
  created_at?: string | Date | null;
};

class AgentExecutionError extends Error {
  agentResult?: unknown;

  constructor(message: string, agentResult?: unknown) {
    super(message);
    this.name = "AgentExecutionError";
    this.agentResult = agentResult;
  }
}

const MigrationDetails = ({ project, onRefresh }: MigrationDetailsProps) => {
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
  const agentDialogRawOutputId = useId();
  const migrationCardRef = useRef<HTMLDivElement | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(false);
  const [migrationCardHeight, setMigrationCardHeight] = useState<number | null>(null);
  const [workflowBoard, setWorkflowBoard] = useState<WorkflowBoardState>(() => createDefaultWorkflowBoard());

  const appendActivity = useCallback(
    async (type: Activity["type"], title: string) => {
      const timestampIso = new Date().toISOString();

      try {
        await supabase.from("migration_activities").insert({
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

  const defaultWorkflowSteps = useMemo(() => {
    return AGENT_WORKFLOW_STEPS.reduce(
      (result, step, index) => {
        result.set(step.id, {
          title: step.title,
          description: step.description,
          color: step.color,
          agentType: step.agentType,
          priority: index + 1,
          agentPrompt: "",
        });
        return result;
      },
      new Map<
        string,
        {
          title: string;
          description: string;
          color: string;
          agentType: string;
          priority: number;
          agentPrompt: string;
        }
      >(),
    );
  }, []);

  const customWorkflowNodes = useMemo(() => {
    return workflowBoard.nodes.filter((node) => {
      const defaultNode = defaultWorkflowSteps.get(node.id);

      if (!defaultNode) {
        return true;
      }

      const normalizedTitle = node.title.trim();
      const normalizedDescription = (node.description ?? "").trim();
      const normalizedPrompt = (node.agentPrompt ?? "").trim();
      const defaultTitle = defaultNode.title;
      const defaultDescription = (defaultNode.description ?? "").trim();
      const defaultPrompt = (defaultNode.agentPrompt ?? "").trim();

      const hasDifferentTitle = normalizedTitle !== defaultTitle;
      const hasDifferentDescription = normalizedDescription !== defaultDescription;
      const hasDifferentColor = node.color !== defaultNode.color;
      const hasDifferentStatus = node.status !== "pending";
      const hasDifferentActiveState = node.active !== true;
      const hasDifferentAgentType = (node.agentType ?? "") !== defaultNode.agentType;
      const hasDifferentPriority = node.priority !== defaultNode.priority;
      const hasDifferentPrompt = normalizedPrompt !== defaultPrompt;

      return (
        hasDifferentTitle ||
        hasDifferentDescription ||
        hasDifferentColor ||
        hasDifferentStatus ||
        hasDifferentActiveState ||
        hasDifferentAgentType ||
        hasDifferentPriority ||
        hasDifferentPrompt
      );
    });
  }, [defaultWorkflowSteps, workflowBoard.nodes]);

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

        const { error: activityError } = await supabase
          .from("migration_activities")
          .insert({
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
    ): Promise<SystemDetectionStepResult | undefined> => {
      if (!node.agentType || node.active === false) {
        return undefined;
      }

      const reportProgress = (value: number) => {
        if (options?.onProgress) {
          options.onProgress(clampProgressValue(value));
        }
      };

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
            const detection = await runSystemDetectionAgent(baseUrl, expectedSystem || undefined);

            const hasApiVersion = (() => {
              if (typeof detection.api_version === "string") {
                return detection.api_version.trim().length > 0;
              }

              if (typeof detection.api_version === "number") {
                return Number.isFinite(detection.api_version);
              }

              return false;
            })();

            const normalizedConfidence = confidenceToPercent(detection.confidence);
            const summaryParts = [
              detection.system ?? "Unbekanntes System",
              hasApiVersion && detection.api_version ? `API ${detection.api_version}` : null,
              normalizedConfidence !== null ? `Confidence ${normalizedConfidence}%` : null,
            ].filter(Boolean);

            const statusLabel = detection.detected ? "erfolgreich" : "unvollständig";
            const titleParts = [
              `Systemerkennung ${statusLabel} (${scopeLabel})`,
              summaryParts.join(" · ") || baseUrl,
            ].filter(Boolean);

            if (!hasApiVersion) {
              const failureTitle = [
                `Systemerkennung unvollständig (${scopeLabel})`,
                summaryParts.join(" · ") || baseUrl,
                "Keine API-Version ermittelt",
              ]
                .filter(Boolean)
                .join(" · ");

              const failureMessage =
                `Die Systemerkennung (${scopeLabel}) konnte keine API-Version ermitteln. Bitte Eingaben prüfen und erneut versuchen.`;
              await appendActivity("warning", failureTitle);
              toast.error(`Systemerkennung unvollständig (${scopeLabel}): Keine API-Version ermittelt.`);
              const errorPayload =
                scope === "source"
                  ? { source: detection, error: failureMessage }
                  : { target: detection, error: failureMessage };
              throw new AgentExecutionError(failureMessage, errorPayload);
            }

            await appendActivity(detection.detected ? "success" : "warning", titleParts.join(" · "));

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

      return undefined;
    },
    [
      appendActivity,
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
        await supabase
          .from("migrations")
          .update({ workflow_state: serializeWorkflowState(nextState) })
          .eq("id", project.id);
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
            await supabase
              .from("migrations")
              .update({
                workflow_state: serializeWorkflowState(nextWorkflowState),
              })
              .eq("id", project.id);
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

        await supabase.from("migration_activities").insert({
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

      let completedAgentResult: SystemDetectionStepResult | undefined;
      try {
        completedAgentResult = await executeAgentForStep(completedStepNode, {
          onProgress: isSystemDetectionStep
            ? (value) => setStepProgress(clampProgressValue(value))
            : undefined,
        });
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
          setAgentResultDialogStepId(completedStepNode.id);
          return;
        }
        throw error;
      }

      // Validate system detection result if this is the system-detection step
      if (completedStepNode.id === "system-detection" && completedAgentResult) {
        const sourceDetection = completedAgentResult.source;
        const targetDetection = completedAgentResult.target;

        if (!sourceDetection || !sourceDetection.detected) {
          const errorMsg =
            "Systemerkennung fehlgeschlagen: Es konnte kein Quellsystem hinter der URL erkannt werden.";
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const expectedSourceSystem = project.sourceSystem?.toLowerCase().trim();
        const detectedSourceSystem = sourceDetection.system?.toLowerCase().trim();

        if (
          !detectedSourceSystem ||
          !expectedSourceSystem ||
          !detectedSourceSystem.includes(expectedSourceSystem.split(" ")[0])
        ) {
          const errorMsg = `Systemerkennung fehlgeschlagen: Erkanntes System "${sourceDetection.system}" stimmt nicht mit dem erwarteten Quellsystem "${project.sourceSystem}" überein.`;
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const sourceConfidence = confidenceToPercent(sourceDetection.confidence);
        await appendActivity(
          "success",
          `Quellsystem erfolgreich erkannt: ${sourceDetection.system} (Konfidenz: ${sourceConfidence ?? 0}%)`,
        );

        if (!targetDetection || !targetDetection.detected) {
          const errorMsg =
            "Systemerkennung fehlgeschlagen: Es konnte kein Zielsystem hinter der URL erkannt werden.";
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const expectedTargetSystem = project.targetSystem?.toLowerCase().trim();
        const detectedTargetSystem = targetDetection.system?.toLowerCase().trim();

        if (
          !detectedTargetSystem ||
          !expectedTargetSystem ||
          !detectedTargetSystem.includes(expectedTargetSystem.split(" ")[0])
        ) {
          const errorMsg = `Systemerkennung fehlgeschlagen: Erkanntes System "${targetDetection.system}" stimmt nicht mit dem erwarteten Zielsystem "${project.targetSystem}" überein.`;
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          await revertActiveNodeToPending(
            completedAgentResult ? { ...completedAgentResult, error: errorMsg } : { error: errorMsg },
          );
          setAgentResultDialogStepId(completedStepNode.id);
          setIsUpdatingStatus(false);
          return;
        }

        const targetConfidence = confidenceToPercent(targetDetection.confidence);
        await appendActivity(
          "success",
          `Zielsystem erfolgreich erkannt: ${targetDetection.system} (Konfidenz: ${targetConfidence ?? 0}%)`,
        );

        setStepProgress(100);
      }

      // Mark current step as done (but don't activate next step yet)
      const completedStepTitle = completedStepNode.title;
      const completedActivity = `Schritt abgeschlossen: ${completedStepTitle}`;

      // Save completed step activity to database
      await supabase.from("migration_activities").insert({
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

      const updatedNodes = nodesSnapshot.map((node, idx) => {
        if (idx === stepIndexToComplete) {
          return {
            ...node,
            status: "done" as const,
            agentResult: completedAgentResult ?? node.agentResult,
          };
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

      const { error } = await supabase
        .from("migrations")
        .update({
          progress: isCompleted ? 100 : clampedProgress,
          status: isCompleted ? "completed" : "running",
          workflow_state: serializeWorkflowState(nextWorkflowState)
        })
        .eq("id", project.id);

      if (error) throw error;

      // Check if all steps are completed
      if (isCompleted) {
        const finalActivity = "Alle Schritte abgeschlossen";
        
        // Save final activity to database
        await supabase.from("migration_activities").insert({
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
        const { data, error } = await supabase
          .from("migrations")
          .select("workflow_state")
          .eq("id", project.id)
          .single();

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

  const transferRate = transferInfo.total > 0 ? Math.round((transferInfo.current / transferInfo.total) * 100) : 0;
  const mappedRate = mappedInfo.total > 0 ? Math.round((mappedInfo.current / mappedInfo.total) * 100) : 0;
  const overallProgress = Math.min(100, Math.max(0, Math.round(Number(project.progress) || 0)));
  const statusMeta = MIGRATION_STATUS_META[status];
  const normalizedStatusForFlow: StatusFlowStep =
    status === "completed"
      ? "completed"
      : status === "not_started"
        ? "not_started"
        : "running";
  const currentStatusIndex = MIGRATION_STATUS_FLOW.indexOf(normalizedStatusForFlow);

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
    rawOutput: agentResultDialogRawOutput,
    structuredResult: agentResultDialogStructured,
  } = useMemo(() => {
    if (
      !agentResultDialogNode ||
      agentResultDialogNode.agentResult === undefined ||
      agentResultDialogNode.agentResult === null
    ) {
      return {
        formatted: null as string | null,
        rawOutput: null as string | null,
        structuredResult: null as SystemDetectionResult | SystemDetectionStepResult | null,
      };
    }

    const result = agentResultDialogNode.agentResult;

    let structuredResult: SystemDetectionResult | SystemDetectionStepResult | null = null;
    if (typeof result === "object" && result !== null) {
      if ("source" in result || "target" in result) {
        structuredResult = normalizeSystemDetectionStepResult(result) ?? null;
      } else if ("detected" in result && typeof (result as { detected: unknown }).detected === "boolean") {
        structuredResult = normalizeSystemDetectionResult(result);
      }
    }
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
        return { formatted: null, rawOutput: extractedRawOutput };
      }

      try {
        const parsed = JSON.parse(trimmed);
        const sanitized = removeRawOutput(parsed);
        return {
          formatted: hasStructuredContent(sanitized) ? formatValue(sanitized) : null,
          rawOutput: extractedRawOutput,
        };
      } catch (error) {
        return { formatted: trimmed, rawOutput: null };
      }
    }

    const sanitized = removeRawOutput(result);

    return {
      formatted: hasStructuredContent(sanitized) ? formatValue(sanitized) : null,
      rawOutput: extractedRawOutput,
      structuredResult: structuredResult,
    };
  }, [agentResultDialogNode]);

  const agentDialogSourceResult = useMemo<SystemDetectionResult | null>(() => {
    if (!agentResultDialogStructured) {
      return null;
    }

    if (
      typeof agentResultDialogStructured === "object" &&
      agentResultDialogStructured !== null &&
      "source" in agentResultDialogStructured
    ) {
      const combined = agentResultDialogStructured as SystemDetectionStepResult;
      return combined.source ?? null;
    }

    return agentResultDialogStructured as SystemDetectionResult;
  }, [agentResultDialogStructured]);

  const agentDialogTargetResult = useMemo<SystemDetectionResult | null>(() => {
    if (
      agentResultDialogStructured &&
      typeof agentResultDialogStructured === "object" &&
      agentResultDialogStructured !== null &&
      "source" in agentResultDialogStructured
    ) {
      const combined = agentResultDialogStructured as SystemDetectionStepResult;
      return combined.target ?? null;
    }

    return null;
  }, [agentResultDialogStructured]);

  const systemDetectionNode = useMemo(
    () => workflowBoard.nodes.find((node) => node.id === "system-detection"),
    [workflowBoard.nodes],
  );

  const { systemDetectionSourceResult, systemDetectionTargetResult } = useMemo(() => {
    if (!systemDetectionNode || systemDetectionNode.agentResult === undefined || systemDetectionNode.agentResult === null) {
      return { systemDetectionSourceResult: null as SystemDetectionResult | null, systemDetectionTargetResult: null as SystemDetectionResult | null };
    }

    const combined = normalizeSystemDetectionStepResult(systemDetectionNode.agentResult);
    if (combined) {
      return {
        systemDetectionSourceResult: combined.source,
        systemDetectionTargetResult: combined.target,
      };
    }

    const single = normalizeSystemDetectionResult(systemDetectionNode.agentResult);
    return {
      systemDetectionSourceResult: single,
      systemDetectionTargetResult: null,
    };
  }, [systemDetectionNode]);

  const systemDetectionSourceConfidencePercent = useMemo(
    () => confidenceToPercent(systemDetectionSourceResult?.confidence ?? null),
    [systemDetectionSourceResult],
  );

  const systemDetectionTargetConfidencePercent = useMemo(
    () => confidenceToPercent(systemDetectionTargetResult?.confidence ?? null),
    [systemDetectionTargetResult],
  );

  const systemDetectionSourceStatusSummary = useMemo(() => {
    const statusCodes = systemDetectionSourceResult?.detection_evidence?.status_codes;

    if (!statusCodes || typeof statusCodes !== "object") {
      return null;
    }

    const summaryParts = Object.entries(statusCodes)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => `${key}: ${value}`);

    return summaryParts.length > 0 ? summaryParts.join(" · ") : null;
  }, [systemDetectionSourceResult]);

  const systemDetectionTargetStatusSummary = useMemo(() => {
    const statusCodes = systemDetectionTargetResult?.detection_evidence?.status_codes;

    if (!statusCodes || typeof statusCodes !== "object") {
      return null;
    }

    const summaryParts = Object.entries(statusCodes)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => `${key}: ${value}`);

    return summaryParts.length > 0 ? summaryParts.join(" · ") : null;
  }, [systemDetectionTargetResult]);

  const systemDetectionSourceHeaderSummary = useMemo(() => {
    const headers = systemDetectionSourceResult?.detection_evidence?.headers;

    if (!Array.isArray(headers) || headers.length === 0) {
      return null;
    }

    return headers.slice(0, 3).join(", ");
  }, [systemDetectionSourceResult]);

  const systemDetectionTargetHeaderSummary = useMemo(() => {
    const headers = systemDetectionTargetResult?.detection_evidence?.headers;

    if (!Array.isArray(headers) || headers.length === 0) {
      return null;
    }

    return headers.slice(0, 3).join(", ");
  }, [systemDetectionTargetResult]);

  const schemaDiscoveryStepState = agentSteps.find((step) => step.id === "schema-discovery");
  const dryRunStepState = agentSteps.find((step) => step.id === "dry-run");
  const verificationStepState = agentSteps.find((step) => step.id === "verification");

  const sourceTotalsVisible = schemaDiscoveryStepState
    ? overallProgress >= schemaDiscoveryStepState.endThreshold
    : false;
  const targetTotalsVisible = dryRunStepState ? overallProgress >= dryRunStepState.endThreshold : false;
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
      const { error } = await supabase
        .from("migrations")
        .update({ notes })
        .eq("id", project.id);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsWideLayout(event.matches);
    };

    setIsWideLayout(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
      return () => mediaQuery.removeEventListener("change", handleMediaChange);
    }

    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, []);

  useEffect(() => {
    if (!isWideLayout || !migrationCardRef.current) {
      setMigrationCardHeight(null);
      return;
    }

    const element = migrationCardRef.current;

    const updateHeight = () => {
      if (!element) return;
      const nextHeight = element.getBoundingClientRect().height;
      setMigrationCardHeight(nextHeight);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isWideLayout]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
          <Card ref={migrationCardRef} className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Migration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/80 p-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <CircularProgress progress={overallProgress} size={48} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Gesamtfortschritt</p>
                    <p className="text-lg font-semibold">{overallProgress}%</p>
                  </div>
                </div>
                
                  <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/80 p-3">
                  <Badge variant="secondary" className={cn("text-xs", statusMeta.badgeClassName)}>
                    {statusMeta.label}
                  </Badge>
                  <div className="flex-1 flex gap-2">
                    {(status === "not_started" || status === "running") && overallProgress < 100 && (
                      <Button size="sm" onClick={handleNextWorkflowStep} disabled={isUpdatingStatus || isStepRunning}>
                        {isStepRunning ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Läuft...
                          </>
                        ) : (
                          <>
                            <Play className="mr-1 h-3 w-3" />
                            {status === "not_started" ? "Starten" : "Fortsetzen"}
                          </>
                        )}
                      </Button>
                    )}
                    {overallProgress >= 100 && status !== "completed" && (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateStatus("completed")} disabled={isUpdatingStatus}>
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Abschließen
                      </Button>
                    )}
                    {status === "paused" && (
                      <Button size="sm" onClick={() => handleUpdateStatus("running")} disabled={isUpdatingStatus}>
                        <Play className="mr-1 h-3 w-3" />
                        Fortsetzen
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-border/60 bg-background/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className={cn("h-4 w-4", activeColorTheme.accentText, isStepRunning && "animate-pulse")} />
                      <div>
                        <p className="text-sm font-semibold">{activeStep ? activeStep.title : "Noch kein Agent aktiv"}</p>
                        <p className="text-xs text-muted-foreground">
                          Schritt {completedCount + (isStepRunning ? 1 : 0)} / {agentSteps.length || 12}
                          {isStepRunning && " · Wird ausgeführt..."}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {stepProgress > 0 ? Math.round(stepProgress) : activeStepProgressPercent}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all ease-out", 
                        activeColorTheme.progressBar,
                        isStepRunning ? "duration-100" : "duration-700"
                      )}
                      style={{ width: `${stepProgress > 0 ? stepProgress : activeStepProgressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Workflow className="h-3.5 w-3.5" />
                      <span>Migration</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                      <span>{project.sourceSystem}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{project.targetSystem}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5">
                    <div className="grid grid-cols-1 sm:grid-cols-2">
                      <div className="p-3">
                        <p className="text-xs text-muted-foreground">
                          Objekte in {project.sourceSystem || "Quellsystem"}
                        </p>
                        <p className="mt-1 text-sm font-semibold">{sourceObjectsDisplay}</p>
                      </div>
                      <div className="border-t border-primary/30 p-3 sm:border-t-0 sm:border-l">
                        <p className="text-xs text-muted-foreground">
                          Objekte in {project.targetSystem || "Zielsystem"}
                        </p>
                        <p className="mt-1 text-sm font-semibold">{targetObjectsDisplay}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-border/60 bg-background/80 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">Workflow</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {workflowBoard.nodes.filter(n => n.status === "done" || n.status === "in-progress").length}/{workflowBoard.nodes.length}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenWorkflowPanel()}
                      className="h-7 px-2"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1.5 pr-3">
                    {agentSteps.map((step) => {
                      const isCompleted = step.status === "completed";
                      const isActive = step.status === "active";
                      const isPending = step.status === "upcoming";
                      const associatedNode = workflowNodeMap[step.id];
                      const hasAgentResult = nodeHasAgentResult(associatedNode);
                      const canOpenAgentOutput = hasAgentResult;
                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border p-2 transition-all",
                            isCompleted && "border-emerald-500/50 bg-emerald-500/10",
                            isActive && "border-amber-500/50 bg-amber-500/10 shadow-sm",
                            isPending && "border-border/60 bg-background/60"
                          )}
                        >
                          <div className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                            isCompleted && "border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                            isActive && "border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-300",
                            isPending && "border-border/60 bg-background/80 text-muted-foreground"
                          )}>
                            {step.index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{step.title}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                            ) : isActive ? (
                              <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-border/60" />
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => canOpenAgentOutput && setAgentResultDialogStepId(step.id)}
                              disabled={!canOpenAgentOutput}
                              aria-label="Agenten-Output anzeigen"
                              title={
                                canOpenAgentOutput
                                  ? "Agenten-Output anzeigen"
                                  : "Kein Agenten-Output verfügbar"
                              }
                            >
                              <SquareArrowOutUpRight
                                className={cn(
                                  "h-3.5 w-3.5",
                                  canOpenAgentOutput ? "text-foreground" : "text-muted-foreground",
                                )}
                              />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <Card
            className="flex flex-col overflow-hidden border-border bg-card"
            style={{
              height: isWideLayout && migrationCardHeight ? `${migrationCardHeight}px` : '600px',
            }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aktivitäten</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
              <ScrollArea className="h-full pr-3">
                <ActivityTimeline activities={activityLog} />
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Anmerkungen</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-3">
              <Textarea
                id="migration-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Beschreibe hier dein Prompt: Ziel der Migration, relevante Randbedingungen und gewünschte Unterstützung."
                rows={6}
                className="min-h-[120px]"
              />
              <Button onClick={handleSaveNotes} disabled={!isNotesDirty || isSavingNotes} size="sm" className="self-end">
                {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={agentResultDialogStepId !== null} onOpenChange={handleAgentResultDialogOpenChange}>
        <DialogContent className="w-full max-w-[98vw] sm:max-w-[92rem]">
          <DialogHeader className="px-8">
            <DialogTitle>Agenten-Output</DialogTitle>
            {agentResultDialogStep && (
              <DialogDescription>
                Schritt {agentResultDialogStep.index + 1}: {agentResultDialogStep.title}
              </DialogDescription>
            )}
          </DialogHeader>
          <ScrollArea className="max-h-[78vh] px-8 pb-2">
            {agentResultDialogStructured ? (
              <AgentOutputDisplay
                sourceResult={agentDialogSourceResult}
                targetResult={agentDialogTargetResult}
              />
            ) : agentResultDialogFormatted ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground p-4 rounded-md border border-border/60 bg-muted/40">
                {agentResultDialogFormatted}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground p-4">
                Für diesen Schritt wurde kein Agenten-Output gespeichert.
              </p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <WorkflowPanelDialog
        open={isWorkflowPanelOpen}
        onOpenChange={setIsWorkflowPanelOpen}
        workflow={workflowBoard}
        onWorkflowChange={handleWorkflowChange}
        initialSelectedNodeId={workflowPanelSelection}
      />
    </div>
  );
};

export default MigrationDetails;
