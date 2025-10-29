import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Sparkles, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import CircularProgress from "./CircularProgress";
import ActivityTimeline, { Activity } from "./ActivityTimeline";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import AgentWorkflowTab from "./AgentWorkflowTab";
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
  activeTab: "general" | "agent";
  onRefresh: () => Promise<void>;
  onWorkflowModeChange?: (mode: "agent" | "manual" | null) => void;
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

const MigrationDetails = ({ project, activeTab, onRefresh, onWorkflowModeChange }: MigrationDetailsProps) => {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
  const [workflowBoard, setWorkflowBoard] = useState<WorkflowBoardState>({
    nodes: [
      {
        id: "discover",
        title: "Analyse & Scope",
        description: "Initiale Bewertung der Migration",
        x: 80,
        y: 80,
        color: "sky",
        status: "pending",
      },
      {
        id: "build",
        title: "Vorbereitung",
        description: "Mappings & Datenquellen harmonisieren",
        x: 340,
        y: 160,
        color: "emerald",
        status: "pending",
      },
      {
        id: "validate",
        title: "Validierung",
        description: "Tests & Qualitätssicherung",
        x: 600,
        y: 80,
        color: "violet",
        status: "pending",
      },
    ],
    connections: [
      { id: "discover-build", sourceId: "discover", targetId: "build" },
      { id: "build-validate", sourceId: "build", targetId: "validate" },
    ],
  });

  const handleWorkflowChange = useCallback(
    (updater: (previous: WorkflowBoardState) => WorkflowBoardState) => {
      setWorkflowBoard((previous) => updater(previous));
    },
    [],
  );

  useEffect(() => {
    setNotes(project.notes ?? "");
  }, [project.id, project.notes]);
  useEffect(() => {
    if (!onWorkflowModeChange) return;

    if (workflowBoard.nodes.length === 0) {
      onWorkflowModeChange(null);
      return;
    }

    onWorkflowModeChange("agent");
  }, [workflowBoard.nodes.length, onWorkflowModeChange]);

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
      {activeTab === "general" ? (
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
                <CardTitle className="text-base">Prompt &amp; Anmerkungen</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Dokumentiere Ziele, Einschränkungen und Kontext für die Migration. Diese Informationen dienen dem Agenten als
                  Briefing.
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
                <div className="flex flex-1 min-h-0 flex-col gap-2">
                  <Label htmlFor="migration-notes" className="sr-only">
                    Briefing für den Agenten
                  </Label>
                  <Textarea
                    id="migration-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Beschreibe hier das Ziel der Migration, relevante Randbedingungen und nächste Schritte."
                    rows={8}
                    className="min-h-[180px] flex-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Änderungen werden nicht automatisch gespeichert.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    onClick={handleSaveNotes}
                    disabled={!isNotesDirty || isSavingNotes}
                    variant="default"
                  >
                    {isSavingNotes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Notizen speichern
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid flex-1 gap-6 xl:grid-cols-[2fr,1fr]">
            <Card className="flex h-full flex-col border-border bg-card">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">Agenten-Workflow</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Visualisiere den geplanten Ablauf des KI-Agenten für diese Migration.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setIsWorkflowPanelOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" /> Workflow Panel öffnen
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                {workflowBoard.nodes.length > 0 ? (
                  <ScrollArea className="h-full pr-2">
                    <div className="space-y-3">
                      {workflowBoard.nodes.map((node, index) => (
                        <div
                          key={node.id}
                          className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-4 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                              <Workflow className="h-3.5 w-3.5" />
                              <span>Schritt {index + 1}</span>
                            </div>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px]",
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
                          <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">{node.title}</h3>
                            <p className="text-xs text-muted-foreground">{node.description || "Noch keine Beschreibung"}</p>
                          </div>
                          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setIsWorkflowPanelOpen(true)}>
                            Im Workflow Panel bearbeiten
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    <Sparkles className="mb-3 h-6 w-6 text-primary" />
                    <p>Lege Schritte im Workflow Panel an, um den Agentenablauf zu planen.</p>
                    <Button className="mt-4" onClick={() => setIsWorkflowPanelOpen(true)}>
                      <Sparkles className="mr-2 h-4 w-4" /> Workflow Panel öffnen
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="flex h-full flex-col border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Aktivitäten</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Alle wichtigen Ereignisse rund um die Migration im Überblick.
                </p>
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
      ) : (
        <div className="flex-1 overflow-hidden p-6">
          <AgentWorkflowTab
            workflow={workflowBoard}
            onOpenPanel={() => setIsWorkflowPanelOpen(true)}
            onWorkflowChange={handleWorkflowChange}
          />
        </div>
      )}

      <WorkflowPanelDialog
        open={isWorkflowPanelOpen}
        onOpenChange={setIsWorkflowPanelOpen}
        workflow={workflowBoard}
        onWorkflowChange={handleWorkflowChange}
      />
    </div>
  );
};

export default MigrationDetails;
