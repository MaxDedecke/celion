import type { FieldMapping, MappingType } from "@/types/mapping";
import { databaseClient } from "@/api/databaseClient";

export const createMappingId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
};

type DbFieldMapping = {
  id: string;
  pipeline_id: string;
  target_field_id: string;
  source_field_id: string;
  mapping_type: string;
  collection_item_field_id: string | null;
  join_with: string | null;
  description: string | null;
  source_object_type: string;
  target_object_type: string;
  created_at: string;
  updated_at: string;
};

const dbMappingToFieldMapping = (dbMapping: DbFieldMapping): FieldMapping => {
  const base = {
    id: dbMapping.id,
    targetFieldId: dbMapping.target_field_id,
    description: dbMapping.description || undefined,
    updatedAt: dbMapping.updated_at,
  };

  if (dbMapping.mapping_type === "collection" && dbMapping.collection_item_field_id) {
    return {
      ...base,
      mappingType: "collection" as const,
      sourceFieldId: dbMapping.source_field_id,
      collectionItemFieldId: dbMapping.collection_item_field_id,
      joinWith: dbMapping.join_with || ", ",
    };
  }

  return {
    ...base,
    mappingType: "direct" as const,
    sourceFieldId: dbMapping.source_field_id,
  };
};

const fieldMappingToDbMapping = (mapping: FieldMapping, pipelineId: string) => {
  const base = {
    pipeline_id: pipelineId,
    target_field_id: mapping.targetFieldId,
    source_field_id: mapping.sourceFieldId,
    mapping_type: mapping.mappingType,
    description: mapping.description || null,
  };

  if (mapping.mappingType === "collection") {
    return {
      ...base,
      collection_item_field_id: mapping.collectionItemFieldId,
      join_with: mapping.joinWith || ", ",
    };
  }

  return {
    ...base,
    collection_item_field_id: null,
    join_with: null,
  };
};

export const loadMappingsFromDatabase = async (
  pipelineId: string,
  sourceObjectType: string,
  targetObjectType: string
): Promise<FieldMapping[]> => {
  try {
    const { data, error } = await databaseClient.fetchFieldMappings(
      pipelineId,
      sourceObjectType,
      targetObjectType
    );

    if (error) {
      console.error("Failed to load mappings from database:", error);
      return [];
    }

    return (data as DbFieldMapping[]).map(dbMappingToFieldMapping);
  } catch (error) {
    console.error("Failed to load mappings:", error);
    return [];
  }
};

export const loadAllMappingsForSource = async (
  pipelineId: string,
  sourceObjectType: string
): Promise<(FieldMapping & { sourceObjectType: string; targetObjectType: string })[]> => {
  try {
    const { data, error } = await databaseClient.fetchAllMappingsForSource(pipelineId, sourceObjectType);

    if (error) {
      console.error("Failed to load all mappings from database:", error);
      return [];
    }

    return (data as DbFieldMapping[]).map(dbMapping => ({
      ...dbMappingToFieldMapping(dbMapping),
      sourceObjectType: dbMapping.source_object_type,
      targetObjectType: dbMapping.target_object_type,
    }));
  } catch (error) {
    console.error("Failed to load all mappings:", error);
    return [];
  }
};

export const saveMappingToDatabase = async (
  pipelineId: string,
  mapping: FieldMapping,
  sourceObjectType: string,
  targetObjectType: string
): Promise<boolean> => {
  try {
    const dbMapping = fieldMappingToDbMapping(mapping, pipelineId);

    const { error } = await databaseClient.upsertFieldMapping({
      id: mapping.id,
      ...dbMapping,
      source_object_type: sourceObjectType,
      target_object_type: targetObjectType
    });

    if (error) {
      console.error("Failed to save mapping to database:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to save mapping:", error);
    return false;
  }
};

export const deleteMappingFromDatabase = async (
  mappingId: string
): Promise<boolean> => {
  try {
    const { error } = await databaseClient.deleteFieldMapping(mappingId);

    if (error) {
      console.error("Failed to delete mapping from database:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to delete mapping:", error);
    return false;
  }
};

export const clearAllMappingsForPipeline = async (
  pipelineId: string
): Promise<boolean> => {
  try {
    const { error } = await databaseClient.clearFieldMappingsForPipeline(pipelineId);

    if (error) {
      console.error("Failed to clear mappings from database:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to clear mappings:", error);
    return false;
  }
};
