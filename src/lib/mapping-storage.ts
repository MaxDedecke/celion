import type { FieldMapping, MappingType } from "@/types/mapping";
import { supabase } from "@/integrations/supabase/client";

export const createMappingId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
};

type DbFieldMapping = {
  id: string;
  migration_id: string;
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

const fieldMappingToDbMapping = (mapping: FieldMapping, migrationId: string) => {
  const base = {
    migration_id: migrationId,
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
  migrationId: string,
  sourceObjectType: string,
  targetObjectType: string
): Promise<FieldMapping[]> => {
  try {
    const { data, error } = await supabase
      .from("field_mappings")
      .select("*")
      .eq("migration_id", migrationId)
      .eq("source_object_type", sourceObjectType)
      .eq("target_object_type", targetObjectType);

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
  migrationId: string,
  sourceObjectType: string
): Promise<(FieldMapping & { sourceObjectType: string; targetObjectType: string })[]> => {
  try {
    const { data, error } = await supabase
      .from("field_mappings")
      .select("*")
      .eq("migration_id", migrationId)
      .eq("source_object_type", sourceObjectType);

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
  migrationId: string,
  mapping: FieldMapping,
  sourceObjectType: string,
  targetObjectType: string
): Promise<boolean> => {
  try {
    const dbMapping = fieldMappingToDbMapping(mapping, migrationId);

    const { error } = await supabase
      .from("field_mappings")
      .upsert({ 
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
    const { error } = await supabase
      .from("field_mappings")
      .delete()
      .eq("id", mappingId);

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

export const clearAllMappingsForMigration = async (
  migrationId: string
): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from("field_mappings")
      .delete()
      .eq("migration_id", migrationId);

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
