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
import { AddPipelineDialog } from "./dialogs/AddPipelineDialog";
import type { Pipeline } from "@/types/pipeline";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

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

const mapPipeline = (pipeline: Tables<"pipelines">): Pipeline => ({
  id: pipeline.id,
  migration_id: pipeline.migration_id,
  name: pipeline.name,
  description: pipeline.description ?? undefined,
  source_data_source_id: pipeline.source_data_source_id ?? undefined,
  target_data_source_id: pipeline.target_data_source_id ?? undefined,
  source_system: pipeline.source_system,
  target_system: pipeline.target_system,
  execution_order: pipeline.execution_order,
  is_active: pipeline.is_active,
  progress: Number(pipeline.progress) || 0,
  objects_transferred: pipeline.objects_transferred,
  mapped_objects: pipeline.mapped_objects,
  workflow_type: (pipeline.workflow_type as "manual" | "agent") ?? "manual",
  created_at: pipeline.created_at,
  updated_at: pipeline.updated_at,
});

const MigrationDetails = ({ project, activeTab, onRefresh, onWorkflowModeChange }: MigrationDetailsProps) => {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [isAddPipelineOpen, setIsAddPipelineOpen] = useState(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("migration_id", project.id)
      .order("execution_order", { ascending: true });

    if (error) {
      console.error("Fehler beim Laden der Pipelines:", error);
      toast.error("Pipelines konnten nicht geladen werden");
      setPipelines([]);
      return;
    }

    if (!data) {
      setPipelines([]);
      return;
    }

    setPipelines(data.map(mapPipeline));
  }, [project.id]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    setNotes(project.notes ?? "");
  }, [project.id, project.notes]);

  const agentPipelines = useMemo(
    () => pipelines.filter((pipeline) => pipeline.workflow_type === "agent"),
    [pipelines],
  );

  useEffect(() => {
    if (!onWorkflowModeChange) return;

    if (pipelines.length === 0) {
      onWorkflowModeChange(null);
      return;
    }

    if (pipelines.some((pipeline) => pipeline.workflow_type === "agent")) {
      onWorkflowModeChange("agent");
      return;
    }

    onWorkflowModeChange("manual");
  }, [pipelines, onWorkflowModeChange]);

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

  const handleAddPipeline = async (pipelineData: {
    name: string;
    description?: string;
    sourceSystem: string;
    targetSystem: string;
    sourceDataSourceId?: string;
    targetDataSourceId?: string;
    workflowType: "manual" | "agent";
  }) => {
    try {
      const { error } = await supabase
        .from("pipelines")
        .insert({
          migration_id: project.id,
          name: pipelineData.name,
          description: pipelineData.description,
          source_system: pipelineData.sourceSystem,
          target_system: pipelineData.targetSystem,
          source_data_source_id: pipelineData.sourceDataSourceId,
          target_data_source_id: pipelineData.targetDataSourceId,
          workflow_type: pipelineData.workflowType,
          execution_order: pipelines.length,
          is_active: true,
          progress: 0,
          objects_transferred: "0/0",
          mapped_objects: "0/0",
        });

      if (error) throw error;

      toast.success("Pipeline hinzugefügt");
      await loadPipelines();
      await onRefresh();
    } catch (error) {
      console.error("Fehler beim Anlegen der Pipeline:", error);
      toast.error("Pipeline konnte nicht angelegt werden");
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

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-base">Prompt &amp; Anmerkungen</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Dokumentiere Ziele, Einschränkungen und Kontext für die Migration. Diese Informationen dienen dem Agenten als
                  Briefing.
                </p>
              </CardHeader>
              <CardContent className="flex h-full flex-col gap-4">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="migration-notes">Briefing für den Agenten</Label>
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
                <Button variant="outline" size="sm" onClick={() => setIsAddPipelineOpen(true)}>
                  <Sparkles className="mr-2 h-4 w-4" /> Workflow ergänzen
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                {agentPipelines.length > 0 ? (
                  <ScrollArea className="h-full pr-2">
                    <div className="space-y-4">
                      {agentPipelines.map((pipeline, index) => {
                        const pipelineProgress = Math.min(100, Math.max(0, Math.round(Number(pipeline.progress) || 0)));
                        return (
                          <div
                            key={pipeline.id}
                            className="rounded-xl border border-border/60 bg-background/60 p-4 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-foreground">{pipeline.name}</h3>
                                {pipeline.description && (
                                  <p className="mt-1 text-xs text-muted-foreground">{pipeline.description}</p>
                                )}
                              </div>
                              <Badge variant="secondary" className="whitespace-nowrap text-xs font-medium">
                                Schritt {index + 1}
                              </Badge>
                            </div>
                            <div className="mt-3 space-y-3">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Fortschritt</span>
                                <span>{pipelineProgress}%</span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary transition-all"
                                  style={{ width: `${pipelineProgress}%` }}
                                />
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{pipeline.source_system}</span>
                                <ArrowRight className="h-3 w-3" />
                                <span>{pipeline.target_system}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{pipeline.objects_transferred} übertragen</span>
                                <span>•</span>
                                <span>{pipeline.mapped_objects} gemappt</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    <Sparkles className="mb-3 h-6 w-6 text-primary" />
                    <p>Lege einen Agenten-Workflow an, um den automatisierten Ablauf der Migration zu planen.</p>
                    <Button className="mt-4" onClick={() => setIsAddPipelineOpen(true)}>
                      <Sparkles className="mr-2 h-4 w-4" /> Workflow hinzufügen
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
            pipelines={pipelines}
            initialPipelineId={agentPipelines[0]?.id ?? null}
            onOpenAddPipeline={() => setIsAddPipelineOpen(true)}
          />
        </div>
      )}

      <AddPipelineDialog
        open={isAddPipelineOpen}
        onOpenChange={setIsAddPipelineOpen}
        onAdd={handleAddPipeline}
        targetSystem={project.targetSystem}
      />
    </div>
  );
};

export default MigrationDetails;
