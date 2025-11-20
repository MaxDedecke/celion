import { forwardRef } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Sparkles,
  SquareArrowOutUpRight,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import CircularProgress from "@/components/CircularProgress";
import { cn } from "@/lib/utils";
import type { MigrationStatus } from "@/types/migration";
import type { WorkflowBoardState, WorkflowNode } from "@/types/workflow";
import type { AgentWorkflowStepState, MigrationProject, MigrationStatusMeta } from "./types";
import type { WorkflowTheme } from "./workflowThemes";
import { nodeHasAgentResult } from "./workflowUtils";

interface MigrationOverviewCardProps {
  project: MigrationProject;
  status: MigrationStatus;
  overallProgress: number;
  statusMeta: MigrationStatusMeta;
  isUpdatingStatus: boolean;
  isStepRunning: boolean;
  stepProgress: number;
  activeStepProgressPercent: number;
  activeColorTheme: WorkflowTheme;
  completedCount: number;
  agentSteps: AgentWorkflowStepState[];
  activeStep: AgentWorkflowStepState | null;
  workflowNodeMap: Record<string, WorkflowNode>;
  workflowBoard: WorkflowBoardState;
  sourceObjectsDisplay: string;
  targetObjectsDisplay: string;
  onNextWorkflowStep: () => void | Promise<void>;
  onUpdateStatus: (status: MigrationStatus) => void | Promise<void>;
  onOpenWorkflowPanel: () => void;
  onOpenAgentOutput: (stepId: string) => void;
  onOpenNotes: () => void;
  hasNotes: boolean;
}

const MigrationOverviewCard = forwardRef<HTMLDivElement, MigrationOverviewCardProps>(
  (
    {
      project,
      status,
      overallProgress,
      statusMeta,
      isUpdatingStatus,
      isStepRunning,
      stepProgress,
      activeStepProgressPercent,
      activeColorTheme,
      completedCount,
      agentSteps,
      activeStep,
      workflowNodeMap,
      workflowBoard,
      sourceObjectsDisplay,
      targetObjectsDisplay,
      onNextWorkflowStep,
      onUpdateStatus,
      onOpenWorkflowPanel,
      onOpenAgentOutput,
      onOpenNotes,
      hasNotes,
    },
    ref,
  ) => {
    return (
      <Card ref={ref} className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Migration</CardTitle>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onOpenNotes}
            >
              <MessageSquare className={cn("h-4 w-4", hasNotes && "text-primary")} />
            </Button>
          </div>
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
              <div className="flex flex-1 gap-2">
                {(status === "not_started" || status === "running") && overallProgress < 100 && (
                  <Button size="sm" onClick={onNextWorkflowStep} disabled={isUpdatingStatus || isStepRunning}>
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
                  <Button size="sm" variant="outline" onClick={() => onUpdateStatus("completed")} disabled={isUpdatingStatus}>
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Abschließen
                  </Button>
                )}
                {status === "paused" && (
                  <Button size="sm" onClick={() => onUpdateStatus("running")} disabled={isUpdatingStatus}>
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
                    isStepRunning ? "duration-100" : "duration-700",
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
                    <p className="text-xs text-muted-foreground">Objekte in {project.sourceSystem || "Quellsystem"}</p>
                    <p className="mt-1 text-sm font-semibold">{sourceObjectsDisplay}</p>
                  </div>
                  <div className="border-t border-primary/30 p-3 sm:border-l sm:border-t-0">
                    <p className="text-xs text-muted-foreground">Objekte in {project.targetSystem || "Zielsystem"}</p>
                    <p className="mt-1 text-sm font-semibold">{targetObjectsDisplay}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-border/60 bg-background/80 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Workflow</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  {workflowBoard.nodes.filter((node) => node.status === "done" || node.status === "in-progress").length}/
                  {workflowBoard.nodes.length}
                </Badge>
                <Button size="sm" variant="ghost" onClick={onOpenWorkflowPanel} className="h-7 px-2">
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
                        isPending && "border-border/60 bg-background/60",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                          isCompleted && "border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                          isActive && "border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-300",
                          isPending && "border-border/60 bg-background/80 text-muted-foreground",
                        )}
                      >
                        {step.index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{step.title}</p>
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
                          onClick={() => canOpenAgentOutput && onOpenAgentOutput(step.id)}
                          disabled={!canOpenAgentOutput}
                          aria-label="Agenten-Output anzeigen"
                          title={canOpenAgentOutput ? "Agenten-Output anzeigen" : "Kein Agenten-Output verfügbar"}
                        >
                          <SquareArrowOutUpRight
                            className={cn("h-3.5 w-3.5", canOpenAgentOutput ? "text-foreground" : "text-muted-foreground")}
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
    );
  },
);

MigrationOverviewCard.displayName = "MigrationOverviewCard";

export default MigrationOverviewCard;
