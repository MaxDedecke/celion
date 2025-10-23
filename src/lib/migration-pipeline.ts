import type { CollectionFieldMapping, FieldMapping } from "@/types/mapping";

export interface PipelineContextInfo {
  sourceSystem?: string;
  targetSystem?: string;
  sourceObject?: string;
  targetObject?: string;
}

export type PipelineLogLevel = "info" | "warn" | "error";

export interface PipelineLogEntry {
  level: PipelineLogLevel;
  message: string;
  mappingId?: string;
  detail?: unknown;
}

export interface PipelineResult {
  result: Record<string, unknown>;
  logs: PipelineLogEntry[];
  errors: PipelineLogEntry[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getJoinValue = (mapping: CollectionFieldMapping) => mapping.joinWith ?? ", ";

export const buildSampleRecordFromMappings = (mappings: FieldMapping[]): Record<string, unknown> => {
  return mappings.reduce<Record<string, unknown>>((acc, mapping) => {
    if (mapping.mappingType === "direct") {
      if (!(mapping.sourceFieldId in acc)) {
        acc[mapping.sourceFieldId] = null;
      }
      return acc;
    }

    if (!(mapping.sourceFieldId in acc)) {
      acc[mapping.sourceFieldId] = [
        { [mapping.collectionItemFieldId]: null },
        { [mapping.collectionItemFieldId]: null },
      ];
    }

    return acc;
  }, {});
};

export async function applyMappingsToRecord(
  sourceRecord: Record<string, unknown>,
  mappings: FieldMapping[],
  context?: PipelineContextInfo
): Promise<PipelineResult> {
  const output: Record<string, unknown> = {};
  const logs: PipelineLogEntry[] = [];
  const errors: PipelineLogEntry[] = [];

  for (const mapping of mappings) {
    if (mapping.mappingType === "direct") {
      output[mapping.targetFieldId] = sourceRecord[mapping.sourceFieldId];
      logs.push({
        level: "info",
        message: `Direct mapping ${mapping.sourceFieldId} → ${mapping.targetFieldId}`,
        mappingId: mapping.id,
        detail: { value: sourceRecord[mapping.sourceFieldId] },
      });
      continue;
    }

    const value = sourceRecord[mapping.sourceFieldId];

    if (!Array.isArray(value)) {
      errors.push({
        level: "error",
        message: `Sammlung ${mapping.sourceFieldId} ist nicht als Array verfügbar`,
        mappingId: mapping.id,
      });
      continue;
    }

    const extracted = value
      .map((entry) => {
        if (isObject(entry)) {
          const nested = entry[mapping.collectionItemFieldId];
          if (nested === undefined || nested === null) {
            return null;
          }
          return String(nested);
        }

        if (entry && typeof entry === "object") {
          return null;
        }

        if (typeof entry === "string" || typeof entry === "number") {
          return String(entry);
        }

        return null;
      })
      .filter((item): item is string => Boolean(item && item.length));

    output[mapping.targetFieldId] = extracted.join(getJoinValue(mapping));

    logs.push({
      level: "info",
      message: `Collection mapping ${mapping.sourceFieldId}[].${mapping.collectionItemFieldId} → ${mapping.targetFieldId}`,
      mappingId: mapping.id,
      detail: { values: extracted },
    });
  }

  return { result: output, logs, errors };
}
