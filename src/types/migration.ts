export type MigrationAuthType = "token" | "credentials";

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
