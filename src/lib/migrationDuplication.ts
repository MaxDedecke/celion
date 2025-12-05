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
  const { data: newMigration, error: duplicateError } = await databaseClient.duplicateMigration(migrationId);

  if (duplicateError) {
    throw new Error("Migration konnte nicht dupliziert werden");
  }

  if (!newMigration) {
    throw new Error("Migration nicht gefunden");
  }

  return newMigration;
};

