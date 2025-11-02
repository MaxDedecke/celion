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

    if (stepCount === 0) {
      return {
        steps: [] as AgentWorkflowStepState[],
        activeStep: null as AgentWorkflowStepState | null,
        nextStep: null as AgentWorkflowStepState | null,
        completedCount: 0,
        progressPerStep: 0,
      };
    }

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
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Migrationsübersicht</CardTitle>
              <p className="text-sm text-muted-foreground">
                Behalte Fortschritt, Systeme und Kennzahlen dieser Migration im Blick.
              </p>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "relative overflow-hidden rounded-2xl border border-border/60 bg-background/90 p-4 transition-all",
                  status === "running" && "ring-2 ring-sky-500/20",
                  status === "paused" && "ring-2 ring-amber-500/20",
                  status === "completed" && "ring-2 ring-emerald-500/20",
                )}
              >
                <div className="pointer-events-none absolute inset-0">
                  <div
                    className={cn(
                      "absolute inset-x-0 -top-20 h-36 bg-gradient-to-br opacity-60 blur-3xl",
                      activeColorTheme.gradient,
                    )}
                  />
                </div>
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={cn("px-3 py-1 text-xs font-semibold", statusMeta.badgeClassName)}
                      >
                        {statusMeta.label}
                      </Badge>
                      {status === "running" && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Läuft im Hintergrund
                        </span>
                      )}
                      {status === "paused" && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-300">
                          <PauseCircle className="h-3.5 w-3.5" />
                          Kurz pausiert
                        </span>
                      )}
                      {status === "completed" && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Geschafft!
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{statusMeta.description}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {status === "not_started" && (
                      <Button
                        onClick={() => handleUpdateStatus("running")}
                        disabled={isUpdatingStatus}
                        className="min-w-[180px] justify-center"
                      >
                        {isUpdatingStatus ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        Prozess starten
                      </Button>
                    )}
                    {status === "running" && (
                      <Button
                        variant="outline"
                        onClick={() => handleUpdateStatus("completed")}
                        disabled={isUpdatingStatus}
                        className="min-w-[180px] justify-center"
                      >
                        {isUpdatingStatus ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        Als abgeschlossen markieren
                      </Button>
                    )}
                    {status === "paused" && (
                      <Button
                        onClick={() => handleUpdateStatus("running")}
                        disabled={isUpdatingStatus}
                        className="min-w-[180px] justify-center"
                      >
                        {isUpdatingStatus ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        Fortsetzen
                      </Button>
                    )}
                  </div>
                </div>
                <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    {MIGRATION_STATUS_FLOW.map((step, index) => {
                      const stepMeta = MIGRATION_STATUS_META[step];
                      const reached = index <= currentStatusIndex;
                      return (
                        <div key={step} className="flex items-center gap-2">
                          {index > 0 && <span className="h-px w-6 bg-border/60" aria-hidden="true" />}
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-colors",
                              reached
                                ? "border-primary/60 bg-primary/5 text-foreground"
                                : "border-border/60 text-muted-foreground",
                            )}
                          >
                            <Workflow className="h-3 w-3" />
                            {stepMeta.label}
                            {index === currentStatusIndex && status !== "completed" && (
                              <span className="sr-only">(aktueller Schritt)</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {status === "paused" && (
                      <div className="flex items-center gap-2">
                        <span className="h-px w-6 bg-border/60" aria-hidden="true" />
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                          <PauseCircle className="h-3 w-3" />
                          Pausiert
                        </span>
                      </div>
                    )}
                  </div>
                  <div className={cn("inline-flex items-center gap-2", activeColorTheme.accentText)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      Aktiver Agent: {activeStep ? `${activeStep.title}` : "Vorbereitung"}
                    </span>
                  </div>
                </div>
                <div className="relative mt-5 h-2 w-full overflow-hidden rounded-full bg-border/40">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-700 ease-out",
                      status === "paused"
                        ? "bg-amber-500"
                        : status === "completed"
                          ? "bg-emerald-500"
                          : activeColorTheme.progressBar,
                      status === "running" && "animate-pulse [animation-duration:2.2s]",
                    )}
                    style={{ width: `${overallProgress}%` }}
                    aria-hidden="true"
                  />
                  <span className="sr-only">Gesamtfortschritt {overallProgress}%</span>
                </div>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[220px,1fr]">
                <div className="flex items-center justify-center rounded-xl bg-muted/40 p-4">
                  <CircularProgress progress={overallProgress} size={200} />
                </div>
                <div className="space-y-5">
                  <div className="rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-2">
                        <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide", activeColorTheme.accentText)}>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Aktiver Agent</span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                            <span>{activeStep ? activeStep.title : "Noch kein Agent aktiv"}</span>
                            {activeStep && (
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", activeColorTheme.accentBadge)}>
                                {activeStep.phase}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {activeStep?.description ?? "Starte die Migration, um den Workflow der Agenten zu aktivieren."}
                          </p>
                        </div>
                      </div>
                      <div className="min-w-[120px] text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Schritt {activeStep ? activeStep.index + 1 : 0} / {agentSteps.length || 12}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-foreground">{activeStepProgressPercent}%</p>
                        <p className="text-[11px] text-muted-foreground">innerhalb dieses Agentenschritts</p>
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 w-full rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all duration-700 ease-out", activeColorTheme.progressBar)}
                        style={{ width: `${activeStepProgressPercent}%` }}
                      />
                    </div>
                    {nextStep && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <ChevronRight className="h-3 w-3" />
                        <span>
                          Nächster Agent: <span className="font-medium text-foreground">{nextStep.title}</span>
                          {" "}
                          <span className="text-muted-foreground/70">({nextStep.phase})</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Workflow className="h-4 w-4" />
                      <span>Systemfluss</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
                      <span>{project.sourceSystem}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span>{project.targetSystem}</span>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-primary/80">Objekte übertragen</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{project.objectsTransferred}</p>
                      <p className="text-xs text-muted-foreground">{transferRate}% abgeschlossen</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mapping-Abdeckung</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">{project.mappedObjects}</p>
                      <p className="text-xs text-muted-foreground">{mappedRate}% vorbereitet</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Meilensteine</h4>
                    <div className="mt-3 space-y-2">
                      {PROGRESS_STAGES.map((stage) => {
                        const reached = overallProgress >= stage.threshold;
                        return (
                          <div
                            key={stage.label}
                            className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              {reached ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : (
                                <Workflow className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="text-sm font-medium text-foreground">{stage.label}</span>
                            </div>
                            <Badge variant={reached ? "secondary" : "outline"}>{stage.threshold}%</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-border/60 bg-background/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Workflow className="h-3.5 w-3.5" />
                    <span>Agenten-Workflow (12 Schritte)</span>
                  </div>
                  <Badge variant="outline" className="text-[11px]">
                    {completedCount}/{agentSteps.length || 12} abgeschlossen
                  </Badge>
                </div>
                <div className="mt-4 max-h-[260px]">
                  <ScrollArea className="max-h-[260px] pr-2">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {agentSteps.map((step) => {
                        const stepTheme = getWorkflowTheme(step.color);
                        const isCompleted = step.status === "completed";
                        const isActive = step.status === "active";
                        return (
                          <div
                            key={step.id}
                            className={cn(
                              "relative flex flex-col gap-2 rounded-xl border border-border/60 bg-background/60 p-4 transition-all",
                              isActive && cn(stepTheme.activeCard, "shadow-lg shadow-black/5"),
                              isCompleted && "border-emerald-500/40 bg-emerald-500/10",
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col gap-1">
                                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5">
                                    #{step.index + 1}
                                  </span>
                                  {isCompleted ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Fertig
                                    </span>
                                  ) : isActive ? (
                                    <span className={cn("inline-flex items-center gap-1", stepTheme.accentText)}>
                                      <Sparkles className="h-3.5 w-3.5" />
                                      Aktiv
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">Bereit</span>
                                  )}
                                </div>
                                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                                <p className="text-xs text-muted-foreground">{step.description}</p>
                              </div>
                              <Badge className={cn("text-[11px]", stepTheme.accentBadge)}>{step.phase}</Badge>
                            </div>
                            <div className="mt-3 h-1.5 w-full rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-700 ease-out",
                                  isCompleted
                                    ? "bg-emerald-500"
                                    : stepTheme.progressBar,
                                )}
                                style={{ width: `${Math.round(step.progress * 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Prompt: Notizen &amp; Kontext</CardTitle>
              <p className="text-sm text-muted-foreground">
                Formuliere hier deinen Prompt mit Zielen, Einschränkungen und Kontext, damit die KI dich bei der Migration optimal unterstützen kann.
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
              <div className="flex flex-1 min-h-0 flex-col gap-2">
                <Label htmlFor="migration-notes" className="sr-only">
                  Prompt zur Migration
                </Label>
                <Textarea
                  id="migration-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Beschreibe hier dein Prompt: Ziel der Migration, relevante Randbedingungen und gewünschte Unterstützung."
                  rows={8}
                  className="min-h-[180px] flex-1"
                />
                <p className="text-xs text-muted-foreground">Hinweis: Dieses Prompt-Fenster speichert Änderungen nicht automatisch.</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleSaveNotes} disabled={!isNotesDirty || isSavingNotes} variant="default">
                  {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Prompt speichern
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
          <Card className="flex h-full flex-col border-border bg-card">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Migrationsworkflow</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Plane die wichtigsten Schritte dieser Migration und passe sie bei Bedarf an.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleOpenWorkflowPanel()}>
                Workflow bearbeiten
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {customWorkflowNodes.length > 0 ? (
                customWorkflowNodes.length > 2 ? (
                  <ScrollArea className="max-h-[360px] pr-2">
                    <div className="space-y-3 pb-2">
                      {customWorkflowNodes.map((node) => (
                        <div
                          key={node.id}
                          className={cn(
                            "flex items-stretch gap-3 rounded-xl border border-border/60 bg-background/60 p-4 shadow-sm transition",
                            !node.active && "border-dashed opacity-70",
                          )}
                        >
                          <div className="flex w-12 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/40 py-2 text-muted-foreground">
                            <span className="text-xs font-medium">#{node.priority}</span>
                          </div>
                          <div className="flex flex-1 flex-col gap-3">
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                                    <Workflow className="h-3.5 w-3.5" />
                                    <span>Schritt {node.priority}</span>
                                    <span className="hidden text-muted-foreground/60 sm:inline">•</span>
                                    <span className="text-muted-foreground/80">Prio {node.priority}</span>
                                  </div>
                                  <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "capitalize",
                                      node.status === "done"
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                                        : node.status === "in-progress"
                                          ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
                                          : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {node.status === "done"
                                      ? "Erledigt"
                                      : node.status === "in-progress"
                                        ? "In Arbeit"
                                        : "Geplant"}
                                  </Badge>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">{node.description || "Noch keine Beschreibung"}</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleOpenWorkflowPanel(node.id)}
                                aria-label="Workflow-Schritt bearbeiten"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "h-8 w-8 text-muted-foreground hover:text-foreground",
                                  !node.active && "text-amber-600 hover:text-amber-500",
                                )}
                                onClick={() => handleToggleWorkflowNodeActive(node.id)}
                                aria-label={node.active ? "Workflow-Schritt deaktivieren" : "Workflow-Schritt aktivieren"}
                              >
                                <Power className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="space-y-3">
                    {customWorkflowNodes.map((node) => (
                      <div
                        key={node.id}
                        className={cn(
                          "flex items-stretch gap-3 rounded-xl border border-border/60 bg-background/60 p-4 shadow-sm transition",
                          !node.active && "border-dashed opacity-70",
                        )}
                      >
                        <div className="flex w-12 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/40 py-2 text-muted-foreground">
                          <span className="text-xs font-medium">#{node.priority}</span>
                        </div>
                        <div className="flex flex-1 flex-col gap-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                                  <Workflow className="h-3.5 w-3.5" />
                                  <span>Schritt {node.priority}</span>
                                  <span className="hidden text-muted-foreground/60 sm:inline">•</span>
                                  <span className="text-muted-foreground/80">Prio {node.priority}</span>
                                </div>
                                <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "capitalize",
                                    node.status === "done"
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                                      : node.status === "in-progress"
                                        ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
                                        : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {node.status === "done"
                                    ? "Erledigt"
                                    : node.status === "in-progress"
                                      ? "In Arbeit"
                                      : "Geplant"}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{node.description || "Noch keine Beschreibung"}</p>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleOpenWorkflowPanel(node.id)}
                              aria-label="Workflow-Schritt bearbeiten"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8 text-muted-foreground hover:text-foreground",
                                !node.active && "text-amber-600 hover:text-amber-500",
                              )}
                              onClick={() => handleToggleWorkflowNodeActive(node.id)}
                              aria-label={node.active ? "Workflow-Schritt deaktivieren" : "Workflow-Schritt aktivieren"}
                            >
                              <Power className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  <p>Keine individuellen Workflow-Schritte konfiguriert.</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    Bearbeite den Workflow, um angepasste Schritte hervorzuheben.
                  </p>
                  <Button className="mt-4" onClick={() => handleOpenWorkflowPanel()}>
                    Workflow bearbeiten
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Aktivitäten</CardTitle>
              <p className="text-sm text-muted-foreground">Alle wichtigen Ereignisse rund um die Migration im Überblick.</p>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {activityLog.length > 0 ? (
                <ScrollArea className="h-full pr-2">
                  <ActivityTimeline activities={activityLog} />
                </ScrollArea>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Noch keine Aktivitäten dokumentiert.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
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
