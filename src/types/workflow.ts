export type WorkflowNodeStatus = "pending" | "in-progress" | "done";

export interface WorkflowNode {
  id: string;
  title: string;
  description: string;
  x: number;
  y: number;
  color: string;
  status: WorkflowNodeStatus;
}

export interface WorkflowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
}

export interface WorkflowBoardState {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}
