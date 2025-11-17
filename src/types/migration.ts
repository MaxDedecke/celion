export type MigrationStatus = "not_started" | "running" | "paused" | "completed";

export interface MigrationSystemAuthConfig {
  apiToken: string;
  email: string;
}

export interface NewMigrationInput {
  name: string;
  sourceUrl: string;
  targetUrl: string;
  sourceSystem: string;
  targetSystem: string;
  sourceAuth: MigrationSystemAuthConfig;
  targetAuth: MigrationSystemAuthConfig;
}
