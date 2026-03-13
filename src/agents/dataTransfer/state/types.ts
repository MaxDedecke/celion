import { StepResult } from "@/types/pipeline";
import { MappingRule } from "@/types/mapping";

export interface ExecutionTask {
  id: string; // e.g., "migrate_users", "migrate_status", "migrate_tickets"
  description: string;
  sourceEntityType: string;
  targetEntityType: string;
  dependsOn: string[]; // Task IDs that must be completed before this one
  status: "pending" | "in_progress" | "completed" | "failed";
  error?: string;
  retries: number;
}

export interface ExecutionPlan {
  tasks: ExecutionTask[];
}

export interface OrchestratorState {
  migrationId: string;
  plan: ExecutionPlan;
  idMappings: Record<string, Record<string, string>>; // sourceEntityType -> sourceId -> targetId
  globalContext: Record<string, any>; // Any extra shared context
  lastUpdated: string; // ISO timestamp
  totalAgentRuns: number; // To enforce limits
}
