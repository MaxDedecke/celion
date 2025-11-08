import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  PauseCircle,
  Pencil,
  Play,
  Power,
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
import WorkflowPanelDialog from "./dialogs/WorkflowPanelDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WorkflowBoardState } from "@/types/workflow";
import type { MigrationStatus } from "@/types/migration";
import { cn } from "@/lib/utils";

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

type AgentWorkflowStepState = (typeof AGENT_WORKFLOW_STEPS)[number] & {
  index: number;
  status: "completed" | "active" | "upcoming";
  progress: number;
  startThreshold: number;
  endThreshold: number;
};

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
  const [workflowBoard, setWorkflowBoard] = useState<WorkflowBoardState>(() => {
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
    }));

    const connections = nodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nodes[index + 1].id}`,
      sourceId: node.id,
      targetId: nodes[index + 1].id,
    }));

    return { nodes, connections };
  });

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

        setActivityLog((previous) => [
          {
            id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: activityType,
            title: activityTitle,
            timestamp: new Date().toLocaleString("de-DE"),
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
    [status],
  );

  const handleNextWorkflowStep = useCallback(async () => {
    if (isStepRunning) return;

    try {
      setIsStepRunning(true);
      setStepProgress(0);

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
      
      // Find current active step
      const currentStepIndex = workflowBoard.nodes.findIndex(node => node.status === "in-progress");
      
      // If no step is in progress, start with the first one
      if (currentStepIndex === -1) {
        const updatedNodes = workflowBoard.nodes.map((node, idx) => ({
          ...node,
          status: idx === 0 ? ("in-progress" as const) : ("pending" as const)
        }));
        
        const newProgress = Math.round((1 / workflowBoard.nodes.length) * 100);
        
        setWorkflowBoard({ ...workflowBoard, nodes: updatedNodes });
        setStatus("running");
        
        const { error } = await supabase
          .from("migrations")
          .update({ 
            progress: newProgress,
            status: "running",
            workflow_state: JSON.stringify({ nodes: updatedNodes, connections: workflowBoard.connections })
          })
          .eq("id", project.id);

        if (error) throw error;

        const activity = `Workflow gestartet: ${updatedNodes[0].title}`;
        setActivityLog((previous) => [
          {
            id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "info",
            title: activity,
            timestamp: new Date().toLocaleString("de-DE"),
          },
          ...previous,
        ]);
        toast.success(activity);
        await onRefresh();
        return;
      }

      // Mark current step as done and activate next step
      const updatedNodes = workflowBoard.nodes.map((node, idx) => {
        if (idx === currentStepIndex) {
          return { ...node, status: "done" as const };
        }
        if (idx === currentStepIndex + 1) {
          return { ...node, status: "in-progress" as const };
        }
        return node;
      });

      const newProgress = Math.round(((currentStepIndex + 2) / workflowBoard.nodes.length) * 100);
      const isCompleted = currentStepIndex + 1 >= workflowBoard.nodes.length - 1;
      
      setWorkflowBoard({ ...workflowBoard, nodes: updatedNodes });
      
      const { error } = await supabase
        .from("migrations")
        .update({ 
          progress: isCompleted ? 100 : newProgress,
          status: isCompleted ? "completed" : "running",
          workflow_state: JSON.stringify({ nodes: updatedNodes, connections: workflowBoard.connections })
        })
        .eq("id", project.id);

      if (error) throw error;

      const nextStep = updatedNodes[currentStepIndex + 1];
      const activity = nextStep 
        ? `Workflow fortgesetzt: ${nextStep.title}` 
        : "Workflow abgeschlossen";
      
      setActivityLog((previous) => [
        {
          id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: nextStep ? "info" : "success",
          title: activity,
          timestamp: new Date().toLocaleString("de-DE"),
        },
        ...previous,
      ]);
      
      if (isCompleted) {
        setStatus("completed");
      }
      
      toast.success(activity);
      await onRefresh();
    } catch (error) {
      console.error("Error progressing workflow:", error);
      toast.error("Fehler beim Fortschreiten des Workflows");
    } finally {
      setIsUpdatingStatus(false);
      setIsStepRunning(false);
      setStepProgress(0);
    }
  }, [workflowBoard, project.id, onRefresh, isStepRunning]);


  useEffect(() => {
    setNotes(project.notes ?? "");
    setStatus(project.status ?? "not_started");
    setActivityLog(project.activities ?? []);
  }, [project.activities, project.id, project.notes, project.status]);

  useEffect(() => {
    if (!isWorkflowPanelOpen) {
      setWorkflowPanelSelection(null);
    }
  }, [isWorkflowPanelOpen]);

  const isNotesDirty = useMemo(() => (project.notes ?? "") !== notes, [project.notes, notes]);

  const transferInfo = useMemo(() => parseProgressPair(project.objectsTransferred), [project.objectsTransferred]);
  const mappedInfo = useMemo(() => parseProgressPair(project.mappedObjects), [project.mappedObjects]);

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
    const stepCount = AGENT_WORKFLOW_STEPS.length;

    const normalizedProgress = Math.max(0, Math.min(100, overallProgress));
    const progressPerStep = 100 / stepCount;
    const activeIndex =
      normalizedProgress >= 100 ? stepCount - 1 : Math.floor(normalizedProgress / progressPerStep);

    const steps: AgentWorkflowStepState[] = AGENT_WORKFLOW_STEPS.map((step, index) => {
      const startThreshold = index * progressPerStep;
      const endThreshold = (index + 1) * progressPerStep;
      const isLastStep = index === stepCount - 1;
      const isCompleted = isLastStep
        ? normalizedProgress >= 100
        : normalizedProgress >= endThreshold;
      const isActive = !isCompleted && index === activeIndex;
      const progressFraction = isCompleted
        ? 1
        : isActive
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

    const activeStep =
      steps.find((step) => step.status === "active") ??
      (normalizedProgress >= 100 ? steps[steps.length - 1] ?? null : steps[0] ?? null);
    const nextStep = steps.find((step) => step.status === "upcoming") ?? null;
    const completedCount = steps.filter((step) => step.status === "completed").length;

    return {
      steps,
      activeStep,
      nextStep,
      completedCount,
      progressPerStep,
    };
  }, [overallProgress]);

  const { steps: agentSteps, activeStep, nextStep, completedCount } = agentWorkflowProgress;
  const activeStepProgressPercent = Math.round((activeStep?.progress ?? 0) * 100);
  const activeColorTheme = getWorkflowTheme(activeStep?.color);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
          <Card className="border-border bg-card">
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
                        {isStepRunning ? Math.round(stepProgress) : activeStepProgressPercent}%
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
                      style={{ width: `${isStepRunning ? stepProgress : activeStepProgressPercent}%` }}
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

                  <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">Objekte übertragen</p>
                    <p className="mt-1 text-sm font-semibold">{project.objectsTransferred}</p>
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
                      {completedCount}/{agentSteps.length || 12}
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
                      const stepTheme = getWorkflowTheme(step.color);
                      const isCompleted = step.status === "completed";
                      const isActive = step.status === "active";
                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border border-border/60 bg-background/60 p-2 transition-all",
                            isActive && cn(stepTheme.activeCard, "shadow-sm"),
                            isCompleted && "border-emerald-500/40 bg-emerald-500/10",
                          )}
                        >
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 text-[10px] font-semibold">
                            {step.index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{step.title}</p>
                          </div>
                          <div className="shrink-0">
                            {isCompleted ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                            ) : isActive ? (
                              <Sparkles className={cn("h-3.5 w-3.5", stepTheme.accentText)} />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-border/60" />
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

          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aktivitäten</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="h-[320px] pr-3">
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
