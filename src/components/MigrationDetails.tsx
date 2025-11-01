import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Pencil,
  Power,
  Trash2,
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

const parseProgressPair = (value: string) => {
  const [current, total] = value.split("/").map((part) => Number(part) || 0);
  return { current, total };
};

const MigrationDetails = ({ project, onRefresh }: MigrationDetailsProps) => {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
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
    }));

    const connections = nodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nodes[index + 1].id}`,
      sourceId: node.id,
      targetId: nodes[index + 1].id,
    }));

    return { nodes, connections };
  });

  const normalizeWorkflowState = useCallback((state: WorkflowBoardState): WorkflowBoardState => {
    const nodesWithDefaults = state.nodes.map((node, index) => ({
      ...node,
      active: typeof node.active === "boolean" ? node.active : true,
      priority: typeof node.priority === "number" ? node.priority : index + 1,
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


  useEffect(() => {
    setNotes(project.notes ?? "");
  }, [project.id, project.notes]);

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
              <div className="grid gap-6 lg:grid-cols-[220px,1fr]">
                <div className="flex items-center justify-center rounded-xl bg-muted/40 p-4">
                  <CircularProgress progress={overallProgress} size={200} />
                </div>
                <div className="space-y-5">
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
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Notizen &amp; Kontext</CardTitle>
              <p className="text-sm text-muted-foreground">
                Dokumentiere Ziele, Einschränkungen und Kontext für die Migration, damit alle Beteiligten informiert bleiben.
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
              <div className="flex flex-1 min-h-0 flex-col gap-2">
                <Label htmlFor="migration-notes" className="sr-only">
                  Notizen zur Migration
                </Label>
                <Textarea
                  id="migration-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Beschreibe hier das Ziel der Migration, relevante Randbedingungen und nächste Schritte."
                  rows={8}
                  className="min-h-[180px] flex-1"
                />
                <p className="text-xs text-muted-foreground">Änderungen werden nicht automatisch gespeichert.</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleSaveNotes} disabled={!isNotesDirty || isSavingNotes} variant="default">
                  {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Notizen speichern
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
              {workflowBoard.nodes.length > 0 ? (
                <ScrollArea className="h-full pr-2">
                  <div className="space-y-3">
                    {workflowBoard.nodes.map((node, index) => (
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
                                  <span>Schritt {index + 1}</span>
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
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  <p>Lege Schritte im Workflow Panel an, um den Ablauf der Migration zu definieren.</p>
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
              {project.activities.length > 0 ? (
                <ScrollArea className="h-full pr-2">
                  <ActivityTimeline activities={project.activities} />
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
