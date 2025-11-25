import { forwardRef } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Play,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CircularProgress from "@/components/CircularProgress";
import { cn } from "@/lib/utils";
import type { MigrationStatus } from "@/types/migration";
import type { WorkflowBoardState, WorkflowNode } from "@/types/workflow";
import type { AgentWorkflowStepState, MigrationProject, MigrationStatusMeta } from "./types";
import type { WorkflowTheme } from "./workflowThemes";

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
    },
    ref,
  ) => {
    return (
      <Card ref={ref} className="border-border bg-card">
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
              <div className="flex flex-1 gap-2">
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
        </CardContent>
      </Card>
    );
  },
);

MigrationOverviewCard.displayName = "MigrationOverviewCard";

export default MigrationOverviewCard;
