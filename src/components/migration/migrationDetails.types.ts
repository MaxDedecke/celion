import type { Database } from "@/integrations/database/types";
import type { Activity } from "../ActivityTimeline";
import type { MigrationProject } from "./types";

export interface MigrationDetailsProps {
  project: MigrationProject;
  onRefresh: () => Promise<void>;
  onStepRunningChange?: (isRunning: boolean) => void;
}

export type RawActivityRecord = {
  id?: string;
  type?: Activity["type"];
  title?: string;
  timestamp?: string | Date | null;
  created_at?: string | Date | null;
};

export type ConnectorRecord = Database["public"]["Tables"]["connectors"]["Row"];

export type AuthContext = {
  baseUrl: string;
  apiToken: string;
  email: string;
};
