import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
import { Maximize2, Minimize2, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";

interface WorkflowPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowBoardState;
  onWorkflowChange: (updater: (previous: WorkflowBoardState) => WorkflowBoardState) => void;
  initialSelectedNodeId?: string | null;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 130;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 0.8;

const statusOptions: Array<{ value: WorkflowNodeStatus; label: string }> = [
  { value: "pending", label: "Geplant" },
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

const agentTypes = [
  { value: "system-detection", label: "System Detection Agent", phase: "1. Discovery", description: "Erkennt automatisch, welches System (z. B. Jira Cloud, Asana, Azure DevOps) hinter einer angegebenen URL steckt und welche API-Version verfügbar ist." },
  { value: "auth-flow", label: "Auth Flow Agent", phase: "2. Authentication", description: "Leitet anhand des erkannten Systems den passenden Authentifizierungsprozess ein (API Token, OAuth2, Basic Auth etc.) und prüft die Berechtigungen." },
  {
    value: "schema-discovery",
    label: "Capability Discovery Agent",
    phase: "3. Capability Analysis",
    description:
      "Findet API-Spezifikationen, analysiert Entities/Endpoints/Auth/Pagination und testet alles über httpClient-Probes.",
  },
  { value: "model-mapping", label: "Model Mapping Agent", phase: "4. Meta-Model Alignment", description: "Ordnet die erkannten Datenfelder des Quellsystems dem Celion-Meta-Modell zu, um eine standardisierte interne Repräsentation zu erzeugen." },
  { value: "target-schema", label: "Target Schema Agent", phase: "5. Target Preparation", description: "Analysiert das Zielsystem (z. B. Asana) und identifiziert, wie dessen Felder mit dem Celion-Meta-Modell kompatibel sind." },
  { value: "mapping-suggestion", label: "Mapping Suggestion Agent", phase: "6. Auto-Mapping", description: "Erstellt ein initiales Feld-zu-Feld-Mapping (Source → Target) basierend auf Ähnlichkeit, Bezeichnung, Typ und Kontext der Daten." },
  { value: "consistency-validation", label: "Consistency & Validation Agent", phase: "7. Validation", description: "Überprüft das vorgeschlagene Mapping auf Typinkonsistenzen, Pflichtfelder und mögliche Datenverluste." },
  { value: "dry-run", label: "Dry-Run Agent", phase: "8. Simulation", description: "Führt eine Simulation der Migration durch (ohne zu schreiben), um Fehler, leere Felder oder API-Limits frühzeitig zu erkennen." },
  { value: "data-transfer", label: "Data Transfer Agent", phase: "9. Execution", description: "Führt die eigentliche Datenmigration aus, orchestriert Requests, Batch-Verarbeitung und Error-Recovery." },
  { value: "verification", label: "Verification Agent", phase: "10. Post-Migration", description: "Prüft, ob alle Objekte korrekt und vollständig im Zielsystem angekommen sind, und erstellt einen Abweichungsreport." },
  { value: "audit", label: "Audit Agent", phase: "11. Audit & Logging", description: "Dokumentiert jede Aktion, API-Request und Datenveränderung revisionssicher für Nachvollziehbarkeit und Compliance." },
  { value: "feedback", label: "Feedback Agent", phase: "12. Optimization & Learning", description: "Lernt aus durchgeführten Migrationen (manuellen Korrekturen, Fehlern, Feedback) und verbessert Mapping-Heuristiken automatisch." },
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
  const lastDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newConnectionTarget, setNewConnectionTarget] = useState<string>("");
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [boardOffset, setBoardOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [boardViewportSize, setBoardViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const element = boardRef.current;
    if (!element) {
      return;
    }

    const updateViewportSize = () => {
      setBoardViewportSize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateViewportSize();

    const observer = new ResizeObserver(() => {
      updateViewportSize();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const boardContentBounds = useMemo(() => {
    const padding = 400;
    const baseWidth = boardViewportSize.width ? boardViewportSize.width / zoomLevel : 0;
    const baseHeight = boardViewportSize.height ? boardViewportSize.height / zoomLevel : 0;

    if (workflow.nodes.length === 0) {
      return {
        width: Math.max(baseWidth, 1200),
        height: Math.max(baseHeight, 800),
        offsetX: 0,
        offsetY: 0,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    workflow.nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    });

    const offsetX = minX < 0 ? minX - padding : 0;
    const offsetY = minY < 0 ? minY - padding : 0;

    const width = Math.max(baseWidth, maxX + padding - offsetX);
    const height = Math.max(baseHeight, maxY + padding - offsetY);

    return { width, height, offsetX, offsetY };
  }, [boardViewportSize.height, boardViewportSize.width, workflow.nodes, zoomLevel]);

  const boardScaleStyle = useMemo(() => {
    return {
      transform: `scale(${zoomLevel})`,
      transformOrigin: "top left",
      width: boardContentBounds.width,
      height: boardContentBounds.height,
    } as const;
  }, [boardContentBounds.height, boardContentBounds.width, zoomLevel]);

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
      setZoomLevel(DEFAULT_ZOOM);
      setBoardOffset({ x: 0, y: 0 });
      setIsPanning(false);
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

    const MAX_MOVE_SPEED = 15; // Maximum pixels per frame

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const boardElement = boardRef.current;
      if (!boardElement) return;

      const rect = boardElement.getBoundingClientRect();
      const relativeX =
        (event.clientX - rect.left - boardOffset.x) / zoomLevel + boardContentBounds.offsetX;
      const relativeY =
        (event.clientY - rect.top - boardOffset.y) / zoomLevel + boardContentBounds.offsetY;
      const targetX = relativeX - dragOffsetRef.current.x;
      const targetY = relativeY - dragOffsetRef.current.y;

      onWorkflowChange((previous) => {
        const updatedNodes = previous.nodes.map((node) => {
          if (node.id !== draggingNodeId) {
            return node;
          }

          // Apply speed limit for smoother dragging
          let newX = targetX;
          let newY = targetY;

          if (lastDragPositionRef.current) {
            const deltaX = targetX - lastDragPositionRef.current.x;
            const deltaY = targetY - lastDragPositionRef.current.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance > MAX_MOVE_SPEED) {
              const ratio = MAX_MOVE_SPEED / distance;
              newX = lastDragPositionRef.current.x + deltaX * ratio;
              newY = lastDragPositionRef.current.y + deltaY * ratio;
            }
          }

          lastDragPositionRef.current = { x: newX, y: newY };

          return { ...node, x: newX, y: newY };
        });

        return {
          ...previous,
          nodes: updatedNodes,
        };
      });
    };

    const handlePointerUp = () => {
      setDraggingNodeId(null);
      lastDragPositionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    boardContentBounds.offsetX,
    boardContentBounds.offsetY,
    boardOffset.x,
    boardOffset.y,
    draggingNodeId,
    onWorkflowChange,
    zoomLevel,
  ]);

  const selectedNode = selectedNodeId ? nodesById[selectedNodeId] ?? null : null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    event.stopPropagation();
    const boardElement = boardRef.current;
    if (!boardElement) return;

    const rect = boardElement.getBoundingClientRect();
    dragOffsetRef.current = {
      x:
        (event.clientX - rect.left - boardOffset.x) / zoomLevel + boardContentBounds.offsetX - node.x,
      y:
        (event.clientY - rect.top - boardOffset.y) / zoomLevel + boardContentBounds.offsetY - node.y,
    };
    lastDragPositionRef.current = { x: node.x, y: node.y };
    setDraggingNodeId(node.id);
    setSelectedNodeId(node.id);
  };

  const handleBoardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-workflow-node="true"]')) {
      return;
    }

    event.preventDefault();
    panStartRef.current = {
      x: event.clientX - boardOffset.x,
      y: event.clientY - boardOffset.y,
    };
    setIsPanning(true);
  };

  useEffect(() => {
    if (!isPanning) return;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setBoardOffset({
        x: event.clientX - panStartRef.current.x,
        y: event.clientY - panStartRef.current.y,
      });
    };

    const handlePointerUp = () => {
      setIsPanning(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isPanning]);

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
    const baseWidth = rect ? rect.width / zoomLevel : undefined;
    const baseHeight = rect ? rect.height / zoomLevel : undefined;
    const baseX = baseWidth ? baseWidth / 2 - NODE_WIDTH / 2 : 120;
    const baseY = baseHeight ? baseHeight / 2 - NODE_HEIGHT / 2 : 120;

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
      agentType: undefined,
      agentPrompt: "",
    };

    onWorkflowChange((previous) => ({
      ...previous,
      nodes: [...previous.nodes, newNode],
    }));
    setSelectedNodeId(newNode.id);
  };

  const removeNode = (nodeId: string) => {
    onWorkflowChange((previous) => ({
      ...previous,
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

    // Helper function to calculate edge point on rectangle
    const getEdgePoint = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      nodeWidth: number,
      nodeHeight: number
    ) => {
      const dx = toX - fromX;
      const dy = toY - fromY;
      
      if (dx === 0 && dy === 0) {
        return { x: fromX, y: fromY };
      }

      // Calculate intersection with rectangle edges
      const halfWidth = nodeWidth / 2;
      const halfHeight = nodeHeight / 2;

      // Normalize direction
      const angle = Math.atan2(dy, dx);
      
      // Check which edge the line intersects first
      const tanAngle = Math.abs(dy / dx);
      const rectRatio = halfHeight / halfWidth;

      let edgeX: number, edgeY: number;

      if (tanAngle > rectRatio) {
        // Intersects top or bottom edge
        edgeY = dy > 0 ? halfHeight : -halfHeight;
        edgeX = edgeY / Math.tan(angle);
      } else {
        // Intersects left or right edge
        edgeX = dx > 0 ? halfWidth : -halfWidth;
        edgeY = edgeX * Math.tan(angle);
      }

      return {
        x: fromX + edgeX,
        y: fromY + edgeY,
      };
    };

    return workflow.connections
      .map((connection) => {
        const source = nodesById[connection.sourceId];
        const target = nodesById[connection.targetId];
        if (!source || !target) return null;

        // Center points of nodes
        const sourceCenterX = source.x + NODE_WIDTH / 2;
        const sourceCenterY = source.y + NODE_HEIGHT / 2;
        const targetCenterX = target.x + NODE_WIDTH / 2;
        const targetCenterY = target.y + NODE_HEIGHT / 2;

        // Calculate edge points
        const sourceEdge = getEdgePoint(
          sourceCenterX,
          sourceCenterY,
          targetCenterX,
          targetCenterY,
          NODE_WIDTH,
          NODE_HEIGHT
        );

        const targetEdge = getEdgePoint(
          targetCenterX,
          targetCenterY,
          sourceCenterX,
          sourceCenterY,
          NODE_WIDTH,
          NODE_HEIGHT
        );

        return {
          id: connection.id,
          x1: sourceEdge.x,
          y1: sourceEdge.y,
          x2: targetEdge.x,
          y2: targetEdge.y,
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
        <DialogHeader className="space-y-3 pr-12">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Workflow bearbeiten</DialogTitle>
              <DialogDescription>
                Arrangiere Schritte, aktualisiere Inhalte und verknüpfe Abhängigkeiten für diesen Migrationsworkflow.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{workflow.nodes.length} Schritte</span>
              <span className="text-muted-foreground/60">•</span>
              <span>{workflow.connections.length} Verknüpfungen</span>
              <span className="text-muted-foreground/60">•</span>
              <span>{Math.round(zoomLevel * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setZoomLevel((value) => Math.max(MIN_ZOOM, parseFloat((value - ZOOM_STEP).toFixed(2))))
                }
                aria-label="Herauszoomen"
                disabled={zoomLevel <= MIN_ZOOM + 0.01}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setZoomLevel((value) => Math.min(MAX_ZOOM, parseFloat((value + ZOOM_STEP).toFixed(2))))
                }
                aria-label="Hereinzoomen"
                disabled={zoomLevel >= MAX_ZOOM - 0.01}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoomLevel(DEFAULT_ZOOM)}
                aria-label="Zoom zurücksetzen"
                disabled={Math.abs(zoomLevel - DEFAULT_ZOOM) < 0.01}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsFullscreen((value) => !value)}
                aria-label={isFullscreen ? "Vollbildmodus beenden" : "Vollbildmodus aktivieren"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {isFullscreen ? "Vollbildmodus beenden" : "Vollbildmodus aktivieren"}
                </span>
              </Button>
            </div>
          </div>

          <div className="flex flex-1 gap-4 overflow-hidden">
            <div
              ref={boardRef}
              className="relative flex-1 overflow-hidden rounded-2xl border border-dashed border-border/60 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border/40)_1px,transparent_0)] bg-[length:32px_32px]"
            >
              <div
                className={cn(
                  "absolute inset-0 cursor-grab",
                  isPanning && "cursor-grabbing",
                )}
                onPointerDown={handleBoardPointerDown}
              >
                <div
                  className="absolute inset-0"
                  style={{ transform: `translate(${boardOffset.x}px, ${boardOffset.y}px)` }}
                >
                  <div className="absolute inset-0 origin-top-left" style={boardScaleStyle}>
                    <svg className="pointer-events-none absolute inset-0 h-full w-full" strokeWidth={2}>
                      {connectionLines.map((line) => (
                        <g key={line.id}>
                          <line
                            x1={line.x1 - boardContentBounds.offsetX}
                            y1={line.y1 - boardContentBounds.offsetY}
                            x2={line.x2 - boardContentBounds.offsetX}
                            y2={line.y2 - boardContentBounds.offsetY}
                            stroke="hsl(var(--primary))"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {line.label && (
                            <text
                              x={(line.x1 + line.x2) / 2 - boardContentBounds.offsetX}
                              y={(line.y1 + line.y2) / 2 - 6 - boardContentBounds.offsetY}
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
                        data-workflow-node="true"
                        className={cn(
                          getNodeClassName(node),
                          selectedNodeId === node.id && "ring-2 ring-primary/80",
                          !node.active && "opacity-70",
                          draggingNodeId === node.id ? "cursor-grabbing" : "cursor-default",
                        )}
                        style={{
                          left: node.x - boardContentBounds.offsetX,
                          top: node.y - boardContentBounds.offsetY,
                        }}
                        onPointerDown={(event) => handlePointerDown(event, node)}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground text-center w-full">{node.title}</p>
                          <Badge variant="secondary" className={cn("text-[10px] uppercase", statusBadgeClasses[node.status])}>
                            {statusOptions.find((option) => option.value === node.status)?.label ?? "Status"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <aside className="hidden w-[280px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-muted/20 p-5 md:flex">
              {selectedNode ? (
                <div className="flex h-full flex-col gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Schritt Details</p>
                    <p className="text-xs text-muted-foreground">
                      Bearbeite Titel, Status und Verbindungen für den ausgewählten Schritt.
                    </p>
                  </div>

                  <ScrollArea className="flex-1">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Agent-Typ</label>
                        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-foreground">
                              {agentTypes.find((a) => a.value === selectedNode.agentType)?.label || "Nicht zugewiesen"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {agentTypes.find((a) => a.value === selectedNode.agentType)?.phase || ""}
                            </span>
                          </div>
                        </div>
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
                          rows={3}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="workflow-node-agent-prompt">
                          Agent Prompt
                        </label>
                        <Textarea
                          id="workflow-node-agent-prompt"
                          value={selectedNode.agentPrompt ?? ""}
                          onChange={(event) => updateNode(selectedNode.id, { agentPrompt: event.target.value })}
                          placeholder="Ergänze Anweisungen für den Agent in diesem Schritt"
                          rows={3}
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
                        <div className="flex flex-wrap justify-center gap-2">
                          {colorOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateNode(selectedNode.id, { color: option.value })}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 border-transparent transition",
                            nodeColorClasses[option.value],
                            ensureColor(selectedNode.color) === option.value
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
                        updateNode(selectedNode.id, {
                          active: Boolean(checked),
                          status: checked ? selectedNode.status : "pending",
                        })
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
                    <label className="text-xs font-medium text-muted-foreground">Neue Verknüpfung</label>
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
                    <p className="text-xs font-medium text-muted-foreground">Bestehende Verknüpfungen</p>
                    <ScrollArea className="h-24 rounded-lg border border-border/60 bg-background/60 p-2">
                      <div className="space-y-2 text-xs">
                        {workflow.connections.filter((connection) => connection.sourceId === selectedNode.id).length === 0 ? (
                          <p className="text-muted-foreground">Keine ausgehenden Verknüpfungen.</p>
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
                                  aria-label="Verknüpfung entfernen"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm font-medium text-foreground">Wähle einen Schritt aus</p>
                  <p className="text-xs text-muted-foreground">
                    Tippe auf ein Element im Whiteboard, um Details zu bearbeiten.
                  </p>
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
