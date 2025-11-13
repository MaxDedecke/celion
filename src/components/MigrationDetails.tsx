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
import type { SystemDetectionResult } from "@/types/agents";
import { runSystemDetectionAgent } from "@/lib/agentService";
import { cn } from "@/lib/utils";
import SystemDetectionOverview from "./SystemDetectionOverview";

interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  sourceSystem: string;
  targetSystem: string;
  objectsTransferred: string;
  mappedObjects: string;
  projectId?: string;
  activities: Activity[];
  notes?: string;
  status: MigrationStatus;
  workflowState?: any;
  inConnectorDetail?: string | null;
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
      ...state,
      nodes: normalizedNodes,
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
    async (node: WorkflowNode): Promise<SystemDetectionResult | undefined> => {
      if (!node.agentType || node.active === false) {
        return undefined;
      }

      if (node.agentType === "system-detection") {
        const baseUrl = project.inConnectorDetail?.trim();

        if (!baseUrl) {
          toast.error("Für die Systemerkennung ist keine API-URL hinterlegt.");
          throw new AgentExecutionError("Keine API-URL für die Systemerkennung hinterlegt.");
        }

        await appendActivity("info", `Systemerkennung gestartet: ${baseUrl}`);

        try {
          const detection = await runSystemDetectionAgent(baseUrl, project.sourceSystem || undefined);

          const normalizedConfidence =
            typeof detection.confidence === "number" && Number.isFinite(detection.confidence)
              ? detection.confidence <= 1
                ? detection.confidence * 100
                : detection.confidence
              : null;

          const hasApiVersion = (() => {
            if (typeof detection.api_version === "string") {
              return detection.api_version.trim().length > 0;
            }

            if (typeof detection.api_version === "number") {
              return Number.isFinite(detection.api_version);
            }

            return false;
          })();

          const summaryParts = [
            detection.system ?? "Unbekanntes System",
            hasApiVersion && detection.api_version ? `API ${detection.api_version}` : null,
          ].filter(Boolean);

          const confidenceText =
            normalizedConfidence !== null ? `Confidence ${Math.round(normalizedConfidence)}%` : null;

          const statusLabel = detection.detected ? "erfolgreich" : "unvollständig";
          const titleParts = [
            `Systemerkennung ${statusLabel}`,
            summaryParts.join(" · ") || baseUrl,
            confidenceText,
          ].filter(Boolean);

          if (!hasApiVersion) {
            const failureTitle = [
              `Systemerkennung unvollständig`,
              summaryParts.join(" · ") || baseUrl,
              "Keine API-Version ermittelt",
            ]
              .filter(Boolean)
              .join(" · ");

            const failureMessage =
              "Die Systemerkennung konnte keine API-Version ermitteln. Bitte Eingaben prüfen und erneut versuchen.";
            await appendActivity("warning", failureTitle);
            toast.error("Systemerkennung unvollständig: Keine API-Version ermittelt.");
            const errorPayload = { ...detection, error: failureMessage };
            throw new AgentExecutionError(failureMessage, errorPayload);
          }

          await appendActivity(detection.detected ? "success" : "warning", titleParts.join(" · "));

          toast.success("Systemerkennung abgeschlossen");

          return detection;
        } catch (error) {
          if (error instanceof AgentExecutionError) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error);
          await appendActivity("error", `Systemerkennung fehlgeschlagen: ${message}`);
          toast.error(`Systemerkennung fehlgeschlagen: ${message}`);
          throw new AgentExecutionError(message, { error: message });
        }
      }

      return undefined;
    },
    [appendActivity, project.inConnectorDetail],
  );

  const handleNextWorkflowStep = useCallback(async () => {
    if (isStepRunning) return;

    try {
      // Reset progress to 0 at the start of a new step
      setStepProgress(0);
      setIsStepRunning(true);

      // Animate progress from 0 to 100 over 2 seconds
      const animationDuration = 2000;
      const animationSteps = 60;
      const stepIncrement = 100 / animationSteps;
      const stepInterval = animationDuration / animationSteps;

      let currentProgress = 0;
      const progressInterval = setInterval(() => {
        currentProgress += stepIncrement;
        if (currentProgress >= 100) {
          setStepProgress(100);
          clearInterval(progressInterval);
        } else {
          setStepProgress(currentProgress);
        }
      }, stepInterval);

      // Wait for animation to complete
      await new Promise((resolve) => setTimeout(resolve, animationDuration + 100));

      setIsUpdatingStatus(true);
      
      const nodesSnapshot = workflowBoard.nodes.map((node) => ({ ...node }));
      const activeStepIndex = nodesSnapshot.findIndex((node) => node.status === "in-progress");
      const nextPendingIndex = nodesSnapshot.findIndex((node) => node.status !== "done");
      const stepIndexToComplete = activeStepIndex !== -1 ? activeStepIndex : nextPendingIndex;

      if (stepIndexToComplete === -1) {
        setStatus("completed");
        await onRefresh();
        return;
      }

      const completedStepNode = nodesSnapshot[stepIndexToComplete];

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
      }

      let completedAgentResult: SystemDetectionResult | undefined;
      try {
        completedAgentResult = await executeAgentForStep(completedStepNode);
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

          setWorkflowBoard((previous) => {
            const updatedNodes = previous.nodes.map((node) => {
              if (node.id !== completedStepNode.id) {
                return node;
              }

              const nextStatus = node.status === "done" ? node.status : ("in-progress" as const);

              return {
                ...node,
                status: nextStatus,
                agentResult: derivedAgentResult,
              };
            });

            return { ...previous, nodes: updatedNodes };
          });

          setAgentResultDialogStepId(completedStepNode.id);
          return;
        }
        throw error;
      }

      // Validate system detection result if this is the system-detection step
      if (completedStepNode.id === "system-detection" && completedAgentResult) {
        const detectionResult = completedAgentResult as SystemDetectionResult;
        
        if (!detectionResult.detected) {
          const errorMsg = "Systemerkennung fehlgeschlagen: Es konnte kein System hinter der URL erkannt werden.";
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          setIsUpdatingStatus(false);
          return;
        }

        const expectedSystem = project.sourceSystem?.toLowerCase().trim();
        const detectedSystem = detectionResult.system?.toLowerCase().trim();

        if (!detectedSystem || !expectedSystem || !detectedSystem.includes(expectedSystem.split(' ')[0])) {
          const errorMsg = `Systemerkennung fehlgeschlagen: Erkanntes System "${detectionResult.system}" stimmt nicht mit dem erwarteten Quellsystem "${project.sourceSystem}" überein.`;
          await appendActivity("error", errorMsg);
          toast.error(errorMsg);
          setIsUpdatingStatus(false);
          return;
        }

        await appendActivity("success", `System erfolgreich erkannt: ${detectionResult.system} (Konfidenz: ${Math.round((detectionResult.confidence || 0) * 100)}%)`);
      }

      // Mark current step as done and activate next step
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
        if (idx === stepIndexToComplete + 1 && node.status !== "done") {
          return { ...node, status: "in-progress" as const };
        }
        return node;
      });

      const completedCount = updatedNodes.filter((node) => node.status === "done").length;
      const stepCount = updatedNodes.length;
      const normalizedProgress = stepCount > 0 ? Math.round((completedCount / stepCount) * 100) : 0;
      const clampedProgress = Math.max(0, Math.min(100, normalizedProgress));
      const isCompleted = completedCount >= stepCount && stepCount > 0;

      setWorkflowBoard((previous) => ({ ...previous, nodes: updatedNodes }));

      const { error } = await supabase
        .from("migrations")
        .update({
          progress: isCompleted ? 100 : clampedProgress,
          status: isCompleted ? "completed" : "running",
          workflow_state: JSON.stringify({ nodes: updatedNodes, connections: workflowBoard.connections })
        })
        .eq("id", project.id);

      if (error) throw error;

      const nextStep = updatedNodes[stepIndexToComplete + 1];
      
      if (nextStep && nextStep.status === "in-progress") {
        const nextStepActivity = `Schritt gestartet: ${nextStep.title}`;

        // Save next step activity to database
        await supabase.from("migration_activities").insert({
          migration_id: project.id,
          type: "info",
          title: nextStepActivity,
          timestamp: new Date().toISOString()
        });
        
        setActivityLog((previous) => [
          {
            id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "info",
            title: nextStepActivity,
            timestamp: new Date().toISOString(),
          },
          ...previous,
        ]);
        toast.success(nextStepActivity);
      } else {
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
      setIsUpdatingStatus(false);
      setIsStepRunning(false);
      // Keep stepProgress at 100 until next step starts
    }
  }, [workflowBoard, project.id, onRefresh, isStepRunning, executeAgentForStep]);

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

  useEffect(() => {
    setNotes(project.notes ?? "");
    setStatus(project.status ?? "not_started");
    setActivityLog((project.activities ?? []).map(normalizeActivity));

    // Load workflow state from database if it exists
    if (project.workflowState) {
      try {
        const parsedState =
          typeof project.workflowState === "string"
            ? JSON.parse(project.workflowState)
            : project.workflowState;

        if (parsedState && parsedState.nodes && Array.isArray(parsedState.nodes)) {
          setWorkflowBoard(normalizeWorkflowState(parsedState));
          return;
        }
      } catch (error) {
        console.error("Error parsing workflow state:", error);
      }
    }

    setWorkflowBoard(createDefaultWorkflowBoard());
  }, [
    project.activities,
    project.id,
    project.notes,
    project.status,
    project.workflowState,
    normalizeActivity,
    normalizeWorkflowState,
  ]);

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
  } = useMemo(() => {
    if (!agentResultDialogNode || agentResultDialogNode.agentResult === undefined || agentResultDialogNode.agentResult === null) {
      return { formatted: null as string | null, rawOutput: null as string | null };
    }

    const result = agentResultDialogNode.agentResult;
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
    };
  }, [agentResultDialogNode]);

  const systemDetectionNode = useMemo(
    () => workflowBoard.nodes.find((node) => node.id === "system-detection"),
    [workflowBoard.nodes],
  );

  const systemDetectionResult = useMemo<SystemDetectionResult | null>(() => {
    if (!systemDetectionNode?.agentResult || typeof systemDetectionNode.agentResult !== "object") {
      return null;
    }

    const candidate = systemDetectionNode.agentResult as Partial<SystemDetectionResult>;
    if (typeof candidate.detected !== "boolean") {
      return null;
    }

    const evidence =
      candidate.detection_evidence && typeof candidate.detection_evidence === "object"
        ? candidate.detection_evidence
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
  }, [systemDetectionNode]);

  const systemDetectionConfidencePercent = useMemo(() => {
    if (!systemDetectionResult?.confidence || !Number.isFinite(systemDetectionResult.confidence)) {
      return null;
    }

    const normalized =
      systemDetectionResult.confidence <= 1
        ? systemDetectionResult.confidence * 100
        : systemDetectionResult.confidence;

    return Math.round(normalized);
  }, [systemDetectionResult]);

  const systemDetectionStatusSummary = useMemo(() => {
    const statusCodes = systemDetectionResult?.detection_evidence?.status_codes;

    if (!statusCodes || typeof statusCodes !== "object") {
      return null;
    }

    const summaryParts = Object.entries(statusCodes)
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => `${key}: ${value}`);

    return summaryParts.length > 0 ? summaryParts.join(" · ") : null;
  }, [systemDetectionResult]);

  const systemDetectionHeaderSummary = useMemo(() => {
    const headers = systemDetectionResult?.detection_evidence?.headers;

    if (!Array.isArray(headers) || headers.length === 0) {
      return null;
    }

    return headers.slice(0, 3).join(", ");
  }, [systemDetectionResult]);

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
                          Schritt {activeStep ? activeStep.index + 1 : 0} / {agentSteps.length || 12}
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
                      const hasAgentResult = Boolean(
                        associatedNode &&
                          associatedNode.agentResult !== undefined &&
                          associatedNode.agentResult !== null &&
                          (typeof associatedNode.agentResult === "string"
                            ? associatedNode.agentResult.trim().length > 0
                            : true),
                      );
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
                            {(isCompleted || hasAgentResult) && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => hasAgentResult && setAgentResultDialogStepId(step.id)}
                                disabled={!hasAgentResult}
                                aria-label="Agenten-Output anzeigen"
                                title={hasAgentResult ? "Agenten-Output anzeigen" : "Kein Agenten-Output verfügbar"}
                              >
                                <SquareArrowOutUpRight
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    hasAgentResult
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                />
                              </Button>
                            )}
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
        <DialogContent className="max-w-[90vw] w-full">
          <DialogHeader>
            <DialogTitle>Agenten-Output</DialogTitle>
            {agentResultDialogStep && (
              <DialogDescription>
                Schritt {agentResultDialogStep.index + 1}: {agentResultDialogStep.title}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Formatierte Ausgabe
              </Label>
              <ScrollArea className="h-[60vh] rounded-md border border-border/60 bg-muted/40 p-4">
                {agentResultDialogFormatted ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                    {agentResultDialogFormatted}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Für diesen Schritt wurde kein Agenten-Output gespeichert.
                  </p>
                )}
              </ScrollArea>
            </div>
            {agentResultDialogRawOutput !== null && (
              <div className="space-y-2">
                <Label htmlFor={agentDialogRawOutputId} className="text-xs font-medium text-muted-foreground">
                  Raw Output
                </Label>
                <ScrollArea className="h-[60vh]">
                  <Textarea
                    id={agentDialogRawOutputId}
                    value={agentResultDialogRawOutput}
                    readOnly
                    spellCheck={false}
                    className="min-h-[calc(60vh-8px)] resize-none bg-muted/20 font-mono text-xs border-border/60"
                  />
                </ScrollArea>
              </div>
            )}
          </div>
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
