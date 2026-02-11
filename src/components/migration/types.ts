import type { Activity } from "../ActivityTimeline";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import type { MigrationStatus } from "@/types/migration";

export interface MigrationProject {
  id: string;
  name: string;
  progress: number;
  sourceSystem: string;
  targetSystem: string;
  sourceUrl?: string | null;
  targetUrl?: string | null;
  objectsTransferred: string;
  mappedObjects: string;
  projectId?: string;
  activities: Activity[];
  notes?: string;
  status: MigrationStatus;
  workflowState?: any;
  inConnectorDetail?: string | null;
  outConnectorDetail?: string | null;
  current_step?: number;
  step_status?: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  consultant_status?: 'idle' | 'thinking';
}

export interface MigrationStatusMeta {
  label: string;
  description: string;
  badgeClassName: string;
}

export type AgentWorkflowStepState = (typeof AGENT_WORKFLOW_STEPS)[number] & {
  index: number;
  status: "completed" | "active" | "upcoming";
  progress: number;
  startThreshold: number;
  endThreshold: number;
};
