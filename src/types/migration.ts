export type MigrationAuthType = "token" | "credentials";

export type MigrationStatus = "not_started" | "running" | "paused" | "completed";

export interface MigrationSystemAuthConfig {
  authType: MigrationAuthType;
  apiToken?: string;
  username?: string;
  password?: string;
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
