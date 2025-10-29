import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  WorkflowBoardState,
  WorkflowConnection,
  WorkflowNode,
  WorkflowNodeStatus,
} from "@/types/workflow";
import { Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";

interface WorkflowPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowBoardState;
  onWorkflowChange: (updater: (previous: WorkflowBoardState) => WorkflowBoardState) => void;
  initialSelectedNodeId?: string | null;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 130;

const statusOptions: Array<{ value: WorkflowNodeStatus; label: string }> = [
  { value: "pending", label: "Offen" },
  { value: "in-progress", label: "In Arbeit" },
  { value: "done", label: "Erledigt" },
];

const colorOptions: Array<{ value: string; label: string }> = [
  { value: "sky", label: "Sky" },
  { value: "violet", label: "Violett" },
  { value: "emerald", label: "Emerald" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
];

const statusBadgeClasses: Record<WorkflowNodeStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  "in-progress": "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
};

const nodeColorClasses: Record<string, string> = {
  sky: "border-sky-400/60 bg-sky-500/10",
  violet: "border-violet-400/60 bg-violet-500/10",
  emerald: "border-emerald-400/60 bg-emerald-500/10",
  amber: "border-amber-400/60 bg-amber-500/10",
  rose: "border-rose-400/60 bg-rose-500/10",
};

const ensureColor = (color: string) => {
  if (nodeColorClasses[color]) {
    return color;
  }

  return "sky";
};

const getNodeClassName = (node: WorkflowNode) =>
  cn(
    "group absolute flex h-[130px] w-[220px] flex-col gap-2 rounded-xl border bg-background/95 p-4 shadow-sm transition-shadow hover:shadow-lg",
    nodeColorClasses[ensureColor(node.color)],
  );

const WorkflowPanelDialog = ({
  open,
  onOpenChange,
  workflow,
  onWorkflowChange,
  initialSelectedNodeId,
}: WorkflowPanelDialogProps) => {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newConnectionTarget, setNewConnectionTarget] = useState<string>("");

  const nodesById = useMemo(() => {
    return workflow.nodes.reduce<Record<string, WorkflowNode>>((result, node) => {
      result[node.id] = node;
      return result;
    }, {});
  }, [workflow.nodes]);

  useEffect(() => {
    if (!open) {
      setSelectedNodeId(null);
      setIsFullscreen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !initialSelectedNodeId) {
      return;
    }

    if (workflow.nodes.some((node) => node.id === initialSelectedNodeId)) {
      setSelectedNodeId(initialSelectedNodeId);
    }
  }, [initialSelectedNodeId, open, workflow.nodes]);

  useEffect(() => {
    if (!selectedNodeId && workflow.nodes.length > 0) {
      setSelectedNodeId(workflow.nodes[0].id);
    }
  }, [selectedNodeId, workflow.nodes]);

  useEffect(() => {
    if (!draggingNodeId) return;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const boardElement = boardRef.current;
      if (!boardElement) return;

      const rect = boardElement.getBoundingClientRect();
      const newX = event.clientX - rect.left - dragOffsetRef.current.x;
      const newY = event.clientY - rect.top - dragOffsetRef.current.y;

      onWorkflowChange((previous) => {
        const updatedNodes = previous.nodes.map((node) => {
          if (node.id !== draggingNodeId) {
            return node;
          }

          const clampedX = Math.min(Math.max(newX, 12), Math.max(rect.width - NODE_WIDTH - 12, 12));
          const clampedY = Math.min(Math.max(newY, 12), Math.max(rect.height - NODE_HEIGHT - 12, 12));

          return { ...node, x: clampedX, y: clampedY };
        });

        return {
          ...previous,
          nodes: updatedNodes,
        };
      });
    };

    const handlePointerUp = () => {
      setDraggingNodeId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingNodeId, onWorkflowChange]);

  const selectedNode = selectedNodeId ? nodesById[selectedNodeId] ?? null : null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    const boardElement = boardRef.current;
    if (!boardElement) return;

    const rect = boardElement.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left - node.x,
      y: event.clientY - rect.top - node.y,
    };
    setDraggingNodeId(node.id);
    setSelectedNodeId(node.id);
  };

  const updateNode = (nodeId: string, patch: Partial<WorkflowNode>) => {
    onWorkflowChange((previous) => ({
      ...previous,
      nodes: previous.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  };

  const addNode = () => {
    const nextIndex = workflow.nodes.length + 1;
    const boardElement = boardRef.current;
    const rect = boardElement?.getBoundingClientRect();
    const baseX = rect ? rect.width / 2 - NODE_WIDTH / 2 : 120;
    const baseY = rect ? rect.height / 2 - NODE_HEIGHT / 2 : 120;

    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      title: `Neuer Schritt ${nextIndex}`,
      description: "",
      x: baseX + nextIndex * 8,
      y: baseY + nextIndex * 6,
      color: "sky",
      status: "pending",
      priority: workflow.nodes.length + 1,
      active: true,
    };

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: [...previous.nodes, newNode],
    }));
    setSelectedNodeId(newNode.id);
  };

  const removeNode = (nodeId: string) => {
    onWorkflowChange((previous) => ({
      nodes: previous.nodes.filter((node) => node.id !== nodeId),
      connections: previous.connections.filter(
        (connection) => connection.sourceId !== nodeId && connection.targetId !== nodeId,
      ),
    }));

    setSelectedNodeId((current) => {
      if (current === nodeId) {
        const remaining = workflow.nodes.filter((node) => node.id !== nodeId);
        return remaining[0]?.id ?? null;
      }

      return current;
    });
  };

  const addConnection = (connection: WorkflowConnection) => {
    onWorkflowChange((previous) => {
      const exists = previous.connections.some(
        (item) =>
          (item.sourceId === connection.sourceId && item.targetId === connection.targetId) ||
          item.id === connection.id,
      );

      if (exists || connection.sourceId === connection.targetId) {
        return previous;
      }

      return {
        ...previous,
        connections: [...previous.connections, connection],
      };
    });
  };

  const removeConnection = (connectionId: string) => {
    onWorkflowChange((previous) => ({
      ...previous,
      connections: previous.connections.filter((connection) => connection.id !== connectionId),
    }));
  };

  const connectionLines = useMemo(() => {
    const boardElement = boardRef.current;
    if (!boardElement) {
      return [] as Array<{ id: string; x1: number; y1: number; x2: number; y2: number; label?: string }>;
    }

    return workflow.connections
      .map((connection) => {
        const source = nodesById[connection.sourceId];
        const target = nodesById[connection.targetId];
        if (!source || !target) return null;

        return {
          id: connection.id,
          x1: source.x + NODE_WIDTH / 2,
          y1: source.y + NODE_HEIGHT / 2,
          x2: target.x + NODE_WIDTH / 2,
          y2: target.y + NODE_HEIGHT / 2,
          label: connection.label,
        };
      })
      .filter(Boolean) as Array<{ id: string; x1: number; y1: number; x2: number; y2: number; label?: string }>;
  }, [workflow.connections, nodesById]);

  useEffect(() => {
    if (!selectedNodeId || !selectedNode) {
      setNewConnectionTarget("");
      return;
    }

    setNewConnectionTarget((current) => {
      if (current && current !== selectedNodeId) {
        return current;
      }

      const fallback = workflow.nodes.find((node) => node.id !== selectedNodeId)?.id ?? "";
      return fallback;
    });
  }, [selectedNodeId, selectedNode, workflow.nodes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[85vh] w-full max-w-[1100px] flex-col gap-5 overflow-hidden p-6",
          isFullscreen && "h-[96vh] max-w-none",
        )}
      >
        <DialogHeader className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Workflow Panel</DialogTitle>
              <DialogDescription>
                Baue visuelle Abläufe für deinen Agenten. Ziehe Schritte auf dem Whiteboard und verknüpfe sie miteinander.
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen((value) => !value)}
              className="gap-2"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-4 w-4" /> Vollbild beenden
                </>
              ) : (
                <>
                  <Maximize2 className="h-4 w-4" /> Vollbild
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{workflow.nodes.length} Schritte</span>
              <span className="text-muted-foreground/60">•</span>
              <span>{workflow.connections.length} Verbindungen</span>
            </div>
            <Button size="sm" onClick={addNode} className="gap-2">
              <Plus className="h-4 w-4" /> Schritt hinzufügen
            </Button>
          </div>

          <div className="flex flex-1 gap-4 overflow-hidden">
            <div
              ref={boardRef}
              className="relative flex-1 overflow-hidden rounded-2xl border border-dashed border-border/60 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border/40)_1px,transparent_0)] bg-[length:32px_32px]"
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full" strokeWidth={2}>
                {connectionLines.map((line) => (
                  <g key={line.id}>
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke="hsl(var(--primary))"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {line.label && (
                      <text
                        x={(line.x1 + line.x2) / 2}
                        y={(line.y1 + line.y2) / 2 - 6}
                        className="fill-muted-foreground text-xs"
                      >
                        {line.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>

              {workflow.nodes.map((node) => (
                <div
                  key={node.id}
                  className={cn(getNodeClassName(node), selectedNodeId === node.id && "ring-2 ring-primary/80")}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => handlePointerDown(event, node)}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{node.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.description || "Noch keine Beschreibung"}</p>
                    </div>
                    <Badge variant="secondary" className={cn("text-[10px] uppercase", statusBadgeClasses[node.status])}>
                      {statusOptions.find((option) => option.value === node.status)?.label ?? "Status"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <aside className="hidden w-[280px] shrink-0 flex-col rounded-2xl border border-border/60 bg-muted/20 p-4 md:flex">
              {selectedNode ? (
                <div className="flex h-full flex-col gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Schritt Details</p>
                    <p className="text-xs text-muted-foreground">
                      Bearbeite Titel, Status und Verbindungen für den ausgewählten Schritt.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="workflow-node-title">
                      Titel
                    </label>
                    <Input
                      id="workflow-node-title"
                      value={selectedNode.title}
                      onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })}
                      placeholder="z. B. Validierung vorbereiten"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="workflow-node-description">
                      Beschreibung
                    </label>
                    <Textarea
                      id="workflow-node-description"
                      value={selectedNode.description}
                      onChange={(event) => updateNode(selectedNode.id, { description: event.target.value })}
                      placeholder="Beschreibe die Aufgabe für diesen Schritt"
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <Select
                      value={selectedNode.status}
                      onValueChange={(value) => updateNode(selectedNode.id, { status: value as WorkflowNodeStatus })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Status auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Farbe</label>
                    <div className="flex flex-wrap gap-2">
                      {colorOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateNode(selectedNode.id, { color: option.value })}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 border-transparent transition",
                            nodeColorClasses[option.value],
                            selectedNode.color === option.value
                              ? "ring-2 ring-offset-2 ring-offset-background"
                              : "opacity-70 hover:opacity-100",
                          )}
                          aria-label={`Farbe ${option.label}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="workflow-node-active"
                      checked={selectedNode.active}
                      onCheckedChange={(checked) =>
                        updateNode(selectedNode.id, { active: Boolean(checked) })
                      }
                    />
                    <label
                      htmlFor="workflow-node-active"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Schritt aktiv
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Neue Verbindung</label>
                    <div className="flex items-center gap-2">
                      <Select value={newConnectionTarget} onValueChange={setNewConnectionTarget}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Ziel wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {workflow.nodes
                            .filter((node) => node.id !== selectedNode.id)
                            .map((node) => (
                              <SelectItem key={node.id} value={node.id}>
                                {node.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!newConnectionTarget}
                        onClick={() => {
                          if (!newConnectionTarget) return;
                          addConnection({
                            id: `${selectedNode.id}-${newConnectionTarget}`,
                            sourceId: selectedNode.id,
                            targetId: newConnectionTarget,
                          });
                        }}
                      >
                        Verbinden
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Bestehende Verbindungen</p>
                    <ScrollArea className="h-24 rounded-lg border border-border/60 bg-background/60 p-2">
                      <div className="space-y-2 text-xs">
                        {workflow.connections.filter((connection) => connection.sourceId === selectedNode.id).length === 0 ? (
                          <p className="text-muted-foreground">Keine ausgehenden Verbindungen.</p>
                        ) : (
                          workflow.connections
                            .filter((connection) => connection.sourceId === selectedNode.id)
                            .map((connection) => (
                              <div
                                key={connection.id}
                                className="flex items-center justify-between rounded-md border border-border/50 bg-background px-2 py-1"
                              >
                                <span>{nodesById[connection.targetId]?.title ?? connection.targetId}</span>
                                <button
                                  type="button"
                                  onClick={() => removeConnection(connection.id)}
                                  className="text-muted-foreground transition hover:text-destructive"
                                  aria-label="Verbindung entfernen"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="mt-auto flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeNode(selectedNode.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Schritt löschen
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm font-medium text-foreground">Wähle einen Schritt aus</p>
                  <p className="text-xs text-muted-foreground">Tippe auf ein Element im Whiteboard, um Details zu bearbeiten.</p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WorkflowPanelDialog;
