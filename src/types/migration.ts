export type MigrationAuthType = "token" | "credentials";

export type MigrationStatus = "not_started" | "running" | "paused" | "completed";

export interface NewMigrationInput {
  name: string;
  apiUrl: string;
  sourceSystem: string;
  targetSystem: string;
  authType: MigrationAuthType;
  apiToken?: string;
  username?: string;
  password?: string;
}
