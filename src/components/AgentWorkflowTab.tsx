import { useMemo, useState } from "react";
import { Bot, Sparkles, ListChecks, RotateCcw, ArrowRight, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { WorkflowBoardState } from "@/types/workflow";
import { toast } from "sonner";

interface AgentWorkflowTabProps {
  workflow: WorkflowBoardState;
  onOpenPanel: () => void;
  onWorkflowChange: (updater: (previous: WorkflowBoardState) => WorkflowBoardState) => void;
}

type PlanStep = {
  id: string;
  title: string;
  description: string;
};

type AgentWorkspaceState = {
  briefing: string;
  plan: PlanStep[];
  completedSteps: Record<string, boolean>;
  logs: string[];
  isRunning: boolean;
};

const createInitialAgentState = (): AgentWorkspaceState => ({
  briefing: "",
  plan: [],
  completedSteps: {},
  logs: [],
  isRunning: false,
});

const AgentWorkflowTab = ({ workflow, onOpenPanel, onWorkflowChange }: AgentWorkflowTabProps) => {
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(createInitialAgentState());

  const sortedWorkflowSteps = useMemo(() => {
    return [...workflow.nodes]
      .filter((node) => node.active !== false)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        if (a.y === b.y) {
          return a.x - b.x;
        }

        return a.y - b.y;
      });
  }, [workflow.nodes]);

  const generatePlan = () => {
    if (sortedWorkflowSteps.length === 0) {
      toast.error("Füge zuerst Schritte im Workflow Panel hinzu.");
      return;
    }

    if (!agentState.briefing.trim()) {
      toast.error("Beschreibe das Ziel der Migration, damit der Agent einen Plan erstellen kann.");
      return;
    }

    const plan = sortedWorkflowSteps.map<PlanStep>((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
    }));

    setAgentState((state) => ({
      ...state,
      plan,
      completedSteps: {},
      logs: [
        ...state.logs,
        `🧠 Plan aktualisiert (${new Date().toLocaleTimeString()})`,
      ],
    }));

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) =>
        plan.some((step) => step.id === node.id)
          ? { ...node, status: "pending" }
          : node,
      ),
    }));

    toast.success("Agentenplan wurde aktualisiert.");
  };

  const toggleStep = (stepId: string) => {
    const isCompleted = Boolean(agentState.completedSteps[stepId]);

    setAgentState((state) => ({
      ...state,
      completedSteps: {
        ...state.completedSteps,
        [stepId]: !isCompleted,
      },
    }));

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => {
        if (node.id !== stepId) {
          return node;
        }

        return {
          ...node,
          status: isCompleted ? "pending" : "done",
        };
      }),
    }));
  };

  const executePlan = () => {
    if (agentState.plan.length === 0) {
      toast.error("Erstelle zuerst einen Agentenplan.");
      return;
    }

    if (agentState.isRunning) {
      toast.info("Der Agent arbeitet bereits an diesem Workflow.");
      return;
    }

    const currentPlan = agentState.plan;
    const planIds = new Set(currentPlan.map((step) => step.id));

    setAgentState((state) => ({
      ...state,
      isRunning: true,
      logs: [
        ...state.logs,
        `🚀 Agent gestartet (${new Date().toLocaleTimeString()})`,
      ],
    }));

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => {
        if (!planIds.has(node.id)) {
          return node;
        }

        return {
          ...node,
          status: node.id === currentPlan[0]?.id ? "in-progress" : "pending",
        };
      }),
    }));

    setTimeout(() => {
      setAgentState((state) => {
        const completedSteps = currentPlan.reduce<Record<string, boolean>>((result, step) => {
          result[step.id] = true;
          return result;
        }, {});

        return {
          ...state,
          isRunning: false,
          completedSteps,
          logs: [
            ...state.logs,
            `✅ Agentlauf abgeschlossen (${new Date().toLocaleTimeString()})`,
          ],
        };
      });

      onWorkflowChange((previous) => ({
        ...previous,
        nodes: previous.nodes.map((node) =>
          planIds.has(node.id)
            ? { ...node, status: "done" }
            : node,
        ),
      }));

      toast.success("Migration durch den Agenten abgeschlossen.");
    }, 800);
  };

  const resetWorkspace = () => {
    setAgentState(createInitialAgentState());

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => ({
        ...node,
        status: "pending",
      })),
    }));

    toast.info("Agent Workspace wurde zurückgesetzt.");
  };

  if (sortedWorkflowSteps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-primary/40 bg-primary/5 p-10 text-center">
        <Bot className="h-12 w-12 text-primary" />
        <div className="space-y-2 max-w-xl">
          <h3 className="text-lg font-semibold text-foreground">Starte deine erste Agent Migration</h3>
          <p className="text-sm text-muted-foreground">
            Öffne das Workflow Panel, um einen visuellen Ablauf anzulegen. Danach kannst du den Agentenlauf direkt hier steuern.
          </p>
        </div>
        <Button onClick={onOpenPanel} className="rounded-full px-5">
          <Sparkles className="mr-2 h-4 w-4" />
          Workflow Panel öffnen
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
        <Button variant="outline" onClick={onOpenPanel} className="rounded-full">
          <Sparkles className="mr-2 h-4 w-4" />
          Workflow bearbeiten
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="h-full">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2">
              <CardTitle className="text-base">Agentenablauf</CardTitle>
              <p className="text-sm text-muted-foreground">
                Erstelle ein Briefing und leite daraus die nächsten Aufgaben für den Agenten ab.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="agent-briefing" className="text-sm font-medium text-foreground">
                Agent Briefing
              </label>
              <Textarea
                id="agent-briefing"
                placeholder="Beschreibe das gewünschte Migrationsergebnis, z. B. welche Objekte priorisiert werden sollen oder welche Qualitätsziele gelten."
                className="min-h-[120px]"
                value={agentState.briefing}
                onChange={(event) => {
                  const value = event.target.value;
                  setAgentState((state) => ({
                    ...state,
                    briefing: value,
                  }));
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={generatePlan}>
                <ListChecks className="mr-2 h-4 w-4" />
                Plan generieren
              </Button>
              <Button variant="outline" onClick={resetWorkspace}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Workspace zurücksetzen
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Vorgeschlagene Schritte</h3>
                <span className="text-xs text-muted-foreground">
                  {agentState.plan.length > 0 ? `${agentState.plan.length} Schritte` : "Noch kein Plan"}
                </span>
              </div>

              {agentState.plan.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  Definiere ein Briefing und generiere anschließend den Agentenplan.
                </div>
              ) : (
                <div className="space-y-2">
                  {agentState.plan.map((step, index) => (
                    <label
                      key={step.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background p-3 text-sm hover:border-primary/40"
                    >
                      <Checkbox
                        checked={agentState.completedSteps[step.id] ?? false}
                        onCheckedChange={() => toggleStep(step.id)}
                        className="mt-1"
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            Schritt {index + 1}
                          </Badge>
                          <span className="font-medium text-foreground">{step.title}</span>
                        </div>
                        {step.description && (
                          <p className="text-xs text-muted-foreground">{step.description}</p>
                        )}
                      </div>
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
                <Badge variant={agentState.isRunning ? "default" : "outline"} className="text-xs">
                  {agentState.isRunning ? "Aktiv" : "Bereit"}
                </Badge>
                <span>
                  {agentState.isRunning
                    ? "Agent führt den Workflow aus"
                    : "Warte auf den nächsten Agentenlauf"}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                {sortedWorkflowSteps.map((node, index) => (
                  <div key={node.id} className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        node.status === "done"
                          ? "border-emerald-500/50 text-emerald-600"
                          : node.status === "in-progress"
                            ? "border-sky-500/50 text-sky-600"
                            : "border-border/60 text-muted-foreground"
                      }
                    >
                      {index + 1}
                    </Badge>
                    <span className="flex items-center gap-2 text-foreground">
                      <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                      {node.title}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {node.status === "done"
                        ? "Erledigt"
                        : node.status === "in-progress"
                          ? "In Arbeit"
                          : "Geplant"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={executePlan}
              disabled={agentState.plan.length === 0 || agentState.isRunning}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Agentenlauf starten
            </Button>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Aktivitätsprotokoll</label>
              <ScrollArea className="h-48 rounded-lg border border-border/60 bg-background p-3 text-sm">
                {agentState.logs.length === 0 ? (
                  <p className="text-muted-foreground">Noch keine Aktivitäten protokolliert.</p>
                ) : (
                  <ul className="space-y-2">
                    {agentState.logs.map((entry, index) => (
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
