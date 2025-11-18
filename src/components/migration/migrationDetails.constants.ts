import type { MigrationStatus } from "@/types/migration";
import type { MigrationStatusMeta } from "./types";

export const MIGRATION_STATUS_META: Record<MigrationStatus, MigrationStatusMeta> = {
  not_started: {
    label: "Bereit zum Start",
    description: "Alles vorbereitet – du kannst die Migration mit einem Klick starten.",
    badgeClassName: "bg-muted text-muted-foreground",
  },
  running: {
    label: "Laufend",
    description:
      "Die Migration verarbeitet gerade Daten. Du kannst den Fortschritt hier entspannt verfolgen.",
    badgeClassName: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  paused: {
    label: "Pausiert",
    description: "Der Prozess ruht. Starte ihn erneut, sobald alle offenen Fragen geklärt sind.",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  completed: {
    label: "Abgeschlossen",
    description: "Die Migration ist erfolgreich beendet. Nutze die Notizen, um Learnings festzuhalten.",
    badgeClassName: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
};

export const MIGRATION_STATUS_FLOW = ["not_started", "running", "completed"] as const;
export type StatusFlowStep = (typeof MIGRATION_STATUS_FLOW)[number];

export const WORKFLOW_STATE_CACHE_PREFIX = "celion.workflow-state";
