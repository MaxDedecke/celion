export type MigrationAuthType = "token";

export type MigrationStatus = "not_started" | "running" | "paused" | "completed" | "processing";

export interface MigrationSystemAuthConfig {
  authType: MigrationAuthType;
  apiToken: string;
  email: string;
  password?: string;
}

export interface Migration {
  id: string;
  name: string;
  source_system: string;
  target_system: string;
  source_url: string;
  target_url: string;
  in_connector?: string;
  in_connector_detail?: string;
  out_connector?: string;
  out_connector_detail?: string;
  objects_transferred?: string;
  mapped_objects?: string;
  project_id?: string;
  notes?: string;
  scope_config?: {
    sourceScope?: string;
    targetName?: string;
  };
  workflow_state?: any;
  progress?: number;
  current_step: number;
  step_status: "idle" | "pending" | "running" | "completed" | "failed";
  consultant_status?: "idle" | "thinking";
  status: MigrationStatus;
  created_at: string;
  updated_at?: string;
}

export interface NewMigrationInput {
  name: string;
  sourceUrl: string;
  targetUrl: string;
  sourceSystem: string;
  targetSystem: string;
  sourceAuth: MigrationSystemAuthConfig;
  targetAuth: MigrationSystemAuthConfig;
  scopeConfig?: {
    sourceScope?: string;
    targetName?: string;
  };
}
