import { databaseClient } from "@/api/databaseClient";
import type { TablesInsert } from "@/integrations/database/types";

const DUPLICATE_SUFFIX = " (Kopie)";

const normalizeActivityTimestamp = (timestamp?: string | Date | null, fallback?: string | null) => {
  if (typeof timestamp === "string" && timestamp.trim() !== "") {
    return timestamp;
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }

  if (fallback && fallback.trim() !== "") {
    return fallback;
  }

  return new Date().toISOString();
};

export const generateDuplicateName = (baseName: string, existingNames: string[] = []) => {
  const existing = new Set(existingNames);
  let attempt = `${baseName}${DUPLICATE_SUFFIX}`;
  let counter = 2;

  while (existing.has(attempt)) {
    attempt = `${baseName}${DUPLICATE_SUFFIX} ${counter}`;
    counter += 1;
  }

  return attempt;
};

export const duplicateMigration = async (
  migrationId: string,
  options: { existingNames?: string[] } = {},
) => {
  const { data: original, error: originalError } = await databaseClient.fetchMigrationById(migrationId);

  if (originalError) {
    throw new Error("Migration konnte nicht geladen werden");
  }

  if (!original) {
    throw new Error("Migration nicht gefunden");
  }

  const { data: connectors, error: connectorsError } = await databaseClient.fetchConnectorsByMigration(migrationId);

  if (connectorsError) {
    throw new Error("Connectoren konnten nicht geladen werden");
  }

  const { data: activities, error: activitiesError } = await databaseClient.fetchMigrationActivities(migrationId);

  if (activitiesError) {
    throw new Error("Aktivitäten konnten nicht geladen werden");
  }

  const duplicateName = generateDuplicateName(original.name, options.existingNames);

  const { data: newMigration, error: insertError } = await databaseClient.insertMigration({
    user_id: original.user_id,
    project_id: original.project_id,
    name: duplicateName,
    source_system: original.source_system,
    target_system: original.target_system,
    source_url: original.source_url,
    target_url: original.target_url,
    in_connector: original.in_connector,
    in_connector_detail: original.in_connector_detail,
    out_connector: original.out_connector,
    out_connector_detail: original.out_connector_detail,
    mapped_objects: original.mapped_objects ?? undefined,
    meta_model_approved: original.meta_model_approved ?? undefined,
    objects_transferred: original.objects_transferred ?? undefined,
    progress: original.progress ?? undefined,
    status: original.status ?? undefined,
    notes: original.notes ?? undefined,
    workflow_state: original.workflow_state as any,
  });

  if (insertError || !newMigration) {
    throw new Error("Migration konnte nicht dupliziert werden");
  }

  if ((connectors?.length ?? 0) > 0) {
    const connectorPayload = connectors!.map((connector) => ({
      migration_id: newMigration.id,
      connector_type: connector.connector_type,
      api_url: connector.api_url,
      auth_type: connector.auth_type,
      api_key: connector.api_key,
      username: connector.username,
      password: connector.password,
    }));

    const { error: connectorInsertError } = await databaseClient.insertConnectors(connectorPayload);

    if (connectorInsertError) {
      throw new Error("Connectoren konnten nicht dupliziert werden");
    }
  }

  const duplicatedActivities: TablesInsert<"migration_activities">[] = [
    {
      migration_id: newMigration.id,
      type: "info",
      title: `Migration von "${original.name}" dupliziert`,
      timestamp: new Date().toISOString(),
    },
  ];

  for (const activity of activities || []) {
    duplicatedActivities.push({
      migration_id: newMigration.id,
      type: (activity.type as TablesInsert<"migration_activities">["type"]) ?? "info",
      title: activity.title ?? "",
      timestamp: normalizeActivityTimestamp(activity.timestamp, activity.created_at),
    });
  }

  if (duplicatedActivities.length > 0) {
    const { error: activityError } = await databaseClient.insertMigrationActivities(duplicatedActivities);

    if (activityError) {
      throw new Error("Aktivitäten konnten nicht dupliziert werden");
    }
  }

  return newMigration;
};

