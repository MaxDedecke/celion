import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Sparkles, ListChecks, ArrowRight, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Pipeline } from "@/types/pipeline";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AgentWorkflowTabProps {
  pipelines: Pipeline[];
  initialPipelineId: string | null;
  onOpenAddPipeline: () => void;
}

type AgentPipelineState = {
  briefing: string;
  plan: string[];
  completedSteps: Record<number, boolean>;
  logs: string[];
  isRunning: boolean;
};

const createInitialAgentState = (): AgentPipelineState => ({
  briefing: "",
  plan: [],
  completedSteps: {},
  logs: [],
  isRunning: false,
});

const AgentWorkflowTab = ({ pipelines, initialPipelineId, onOpenAddPipeline }: AgentWorkflowTabProps) => {
  const agentPipelines = useMemo(
    () => pipelines.filter((pipeline) => pipeline.workflow_type === "agent"),
    [pipelines],
  );
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(initialPipelineId);
  const [agentStates, setAgentStates] = useState<Record<string, AgentPipelineState>>({});

  useEffect(() => {
    if (agentPipelines.length === 0) {
      setSelectedPipelineId(null);
      return;
    }

    if (selectedPipelineId && agentPipelines.some((pipeline) => pipeline.id === selectedPipelineId)) {
      return;
    }

    if (initialPipelineId && agentPipelines.some((pipeline) => pipeline.id === initialPipelineId)) {
      setSelectedPipelineId(initialPipelineId);
      return;
    }

    setSelectedPipelineId(agentPipelines[0].id);
  }, [agentPipelines, initialPipelineId, selectedPipelineId]);

  useEffect(() => {
    if (!selectedPipelineId) return;

    const loadAgentState = async () => {
      const { data, error } = await supabase
        .from("agent_workflow_states")
        .select("*")
        .eq("pipeline_id", selectedPipelineId)
        .maybeSingle();

      if (error) {
        console.error("Error loading agent state:", error);
        return;
      }

      if (data) {
        setAgentStates((previous) => ({
          ...previous,
          [selectedPipelineId]: {
            briefing: data.briefing,
            plan: data.plan as string[],
            completedSteps: data.completed_steps as Record<number, boolean>,
            logs: data.logs as string[],
            isRunning: data.is_running,
          },
        }));
      } else {
        setAgentStates((previous) => {
          if (previous[selectedPipelineId]) {
            return previous;
          }

          return {
            ...previous,
            [selectedPipelineId]: createInitialAgentState(),
          };
        });
      }
    };

    loadAgentState();
  }, [selectedPipelineId]);

  const updateAgentState = useCallback(async (pipelineId: string, updater: (state: AgentPipelineState) => AgentPipelineState) => {
    setAgentStates((previous) => {
      const current = previous[pipelineId] ?? createInitialAgentState();
      const newState = updater(current);

      // Persist to database
      supabase
        .from("agent_workflow_states")
        .upsert({
          pipeline_id: pipelineId,
          briefing: newState.briefing,
          plan: newState.plan,
          completed_steps: newState.completedSteps,
          logs: newState.logs,
          is_running: newState.isRunning,
        })
        .then(({ error }) => {
          if (error) {
            console.error("Error saving agent state:", error);
            toast.error("Fehler beim Speichern des Agent-Status");
          }
        });

      return {
        ...previous,
        [pipelineId]: newState,
      };
    });
  }, []);

  const selectedPipeline = useMemo(
    () => agentPipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null,
    [agentPipelines, selectedPipelineId],
  );

  const pipelineState = selectedPipelineId ? agentStates[selectedPipelineId] ?? createInitialAgentState() : createInitialAgentState();

  const generatePlan = () => {
    if (!selectedPipelineId || !selectedPipeline) {
      toast.error("Bitte wähle zuerst eine Agent Pipeline aus.");
      return;
    }

    if (!pipelineState.briefing.trim()) {
      toast.error("Beschreibe das Ziel der Migration, damit der Agent einen Plan erstellen kann.");
      return;
    }

    const dynamicSteps = pipelineState.briefing
      .split(/\n|\./)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const baseSteps = [
      `Analyse der ${selectedPipeline.source_system}-Daten`,
      "Transformationslogik entwerfen",
      `Zielstruktur für ${selectedPipeline.target_system} vorbereiten`,
      "Validierung & Testdurchläufe planen",
    ];

    const mergedPlan = [...baseSteps, ...dynamicSteps].slice(0, 8);

    updateAgentState(selectedPipelineId, (state) => ({
      ...state,
      plan: mergedPlan,
      completedSteps: {},
      logs: [
        ...state.logs,
        `🧠 Plan aktualisiert (${new Date().toLocaleTimeString()})`,
      ],
    }));

    toast.success("Agentenplan wurde aktualisiert.");
  };

  const toggleStep = (index: number) => {
    if (!selectedPipelineId) return;

    updateAgentState(selectedPipelineId, (state) => ({
      ...state,
      completedSteps: {
        ...state.completedSteps,
        [index]: !state.completedSteps[index],
      },
    }));
  };

  const executePlan = () => {
    if (!selectedPipelineId || pipelineState.plan.length === 0) {
      toast.error("Erstelle zuerst einen Agentenplan.");
      return;
    }

    if (pipelineState.isRunning) {
      toast.info("Der Agent arbeitet bereits an dieser Pipeline.");
      return;
    }

    updateAgentState(selectedPipelineId, (state) => ({
      ...state,
      isRunning: true,
      logs: [
        ...state.logs,
        `🚀 Agent gestartet (${new Date().toLocaleTimeString()})`,
      ],
    }));

    const pipelineId = selectedPipelineId as string;
    setTimeout(() => {
      setAgentStates((previous) => {
        const current = pipelineId ? previous[pipelineId] : undefined;
        if (!current) {
          return previous;
        }

        const completedSteps = current.plan.reduce<Record<number, boolean>>((result, _step, index) => {
          result[index] = true;
          return result;
        }, {});

        return {
          ...previous,
          [pipelineId]: {
            ...current,
            isRunning: false,
            completedSteps,
            logs: [
              ...current.logs,
              `✅ Agentlauf abgeschlossen (${new Date().toLocaleTimeString()})`,
            ],
          },
        };
      });

      toast.success("Migration durch den Agenten abgeschlossen.");
    }, 800);
  };

  const resetWorkspace = () => {
    if (!selectedPipelineId) return;

    updateAgentState(selectedPipelineId, () => createInitialAgentState());
    toast.info("Agent Workspace wurde zurückgesetzt.");
  };

  if (agentPipelines.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-primary/40 bg-primary/5 p-10 text-center">
        <Bot className="h-12 w-12 text-primary" />
        <div className="space-y-2 max-w-xl">
          <h3 className="text-lg font-semibold text-foreground">Starte deine erste Agent Migration</h3>
          <p className="text-sm text-muted-foreground">
            Lege eine Pipeline mit dem Workflow-Typ "Agent" an, um Migrationen durch unsere KI-Agenten durchführen zu lassen.
          </p>
        </div>
        <Button onClick={onOpenAddPipeline} className="rounded-full px-5">
          <Sparkles className="mr-2 h-4 w-4" />
          Agent Pipeline erstellen
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Agent Workflow</p>
          <h2 className="text-xl font-semibold text-foreground">Agent Migration Studio</h2>
          <p className="text-sm text-muted-foreground">
            Plane Aufgaben, überwache die Ausführung und begleite die KI bei der Migration.
          </p>
        </div>
        <Button variant="outline" onClick={onOpenAddPipeline} className="rounded-full">
          <Sparkles className="mr-2 h-4 w-4" />
          Weitere Agent Pipeline
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="h-full">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2">
              <CardTitle className="text-base">Aktiver Agent</CardTitle>
              <p className="text-sm text-muted-foreground">
                Wähle die Pipeline, formuliere das Ziel und erstelle anschließend den Aktionsplan.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="agent-pipeline">Pipeline</Label>
                <Select value={selectedPipelineId ?? ""} onValueChange={(value) => setSelectedPipelineId(value)}>
                  <SelectTrigger id="agent-pipeline" className="bg-background">
                    <SelectValue placeholder="Agent Pipeline auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentPipelines.map((pipeline) => (
                      <SelectItem key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPipeline && (
                <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      Agent Workflow
                    </Badge>
                    {!selectedPipeline.is_active && (
                      <Badge variant="outline" className="text-xs">
                        Inaktiv
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">{selectedPipeline.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{selectedPipeline.source_system}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{selectedPipeline.target_system}</span>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="agent-briefing">Agent Briefing</Label>
              <Textarea
                id="agent-briefing"
                placeholder="Beschreibe das gewünschte Migrationsergebnis, z. B. welche Objekte priorisiert werden sollen oder welche Qualitätsziele gelten."
                className="min-h-[120px]"
                value={pipelineState.briefing}
                onChange={(event) => {
                  if (!selectedPipelineId) return;
                  updateAgentState(selectedPipelineId, (state) => ({
                    ...state,
                    briefing: event.target.value,
                  }));
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={generatePlan} disabled={!selectedPipelineId}>
                <ListChecks className="mr-2 h-4 w-4" />
                Plan generieren
              </Button>
              <Button variant="outline" onClick={resetWorkspace} disabled={!selectedPipelineId}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Workspace zurücksetzen
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Vorgeschlagene Schritte</h3>
                <span className="text-xs text-muted-foreground">
                  {pipelineState.plan.length > 0 ? `${pipelineState.plan.length} Schritte` : "Noch kein Plan"}
                </span>
              </div>

              {pipelineState.plan.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  Definiere ein Briefing und generiere anschließend den Agentenplan.
                </div>
              ) : (
                <div className="space-y-2">
                  {pipelineState.plan.map((step, index) => (
                    <label
                      key={`${step}-${index}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background p-3 text-sm hover:border-primary/40"
                    >
                      <Checkbox
                        checked={pipelineState.completedSteps[index] ?? false}
                        onCheckedChange={() => toggleStep(index)}
                        className="mt-1"
                      />
                      <span className="leading-5 text-foreground">{step}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base">Status & Ausführung</CardTitle>
            <p className="text-sm text-muted-foreground">
              Starte den Agentenlauf und beobachte den Fortschritt im Protokoll.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-4">
              <p className="text-sm font-medium text-foreground">Aktueller Status</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={pipelineState.isRunning ? "default" : "outline"} className="text-xs">
                  {pipelineState.isRunning ? "Aktiv" : "Bereit"}
                </Badge>
                <span>
                  {pipelineState.isRunning
                    ? "Agent führt die Migration durch"
                    : "Warte auf den nächsten Agentenlauf"}
                </span>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={executePlan}
              disabled={!selectedPipelineId || pipelineState.plan.length === 0 || pipelineState.isRunning}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Agentenlauf starten
            </Button>

            <div className="space-y-2">
              <Label>Aktivitätsprotokoll</Label>
              <ScrollArea className="h-48 rounded-lg border border-border/60 bg-background p-3 text-sm">
                {pipelineState.logs.length === 0 ? (
                  <p className="text-muted-foreground">Noch keine Aktivitäten protokolliert.</p>
                ) : (
                  <ul className="space-y-2">
                    {pipelineState.logs.map((entry, index) => (
                      <li key={`${entry}-${index}`} className="text-foreground">
                        {entry}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AgentWorkflowTab;
