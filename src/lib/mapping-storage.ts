import type { FieldMapping, MappingType } from "@/types/mapping";

const STORAGE_PREFIX = "field-mapper";

export const createMappingId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
};

export const getMappingStorageKey = (
  sourceSystem: string,
  sourceObject: string,
  targetSystem: string,
  targetObject: string
) => `${STORAGE_PREFIX}:${sourceSystem}:${sourceObject}:${targetSystem}:${targetObject}`;

export type StoredFieldMapping = Partial<FieldMapping> & {
  id?: string;
  targetFieldId: string;
  sourceFieldId?: string;
  mappingType?: MappingType;
  collectionItemFieldId?: string;
  joinWith?: string;
};

export const ensureMappingDefaults = (mapping: StoredFieldMapping): FieldMapping | null => {
  const mappingType: MappingType = mapping.mappingType === "collection" ? "collection" : "direct";
  const sourceFieldId = mapping.sourceFieldId ?? "";

  if (!sourceFieldId) {
    return null;
  }

  const base = {
    id: mapping.id ?? createMappingId(),
    targetFieldId: mapping.targetFieldId,
    description: mapping.description,
    updatedAt: mapping.updatedAt,
  };

  if (mappingType === "collection") {
    const collectionItemFieldId = mapping.collectionItemFieldId ?? "";

    if (!collectionItemFieldId) {
      return null;
    }

    return {
      ...base,
      mappingType,
      sourceFieldId,
      collectionItemFieldId,
      joinWith: mapping.joinWith ?? ", ",
    };
  }

  return {
    ...base,
    mappingType,
    sourceFieldId,
  };
};

export const loadMappingsFromStorage = (key: string): FieldMapping[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredFieldMapping[];
    return parsed
      .map(ensureMappingDefaults)
      .filter((mapping): mapping is FieldMapping => Boolean(mapping));
  } catch (error) {
    console.warn("Failed to parse stored mappings", error);
    return [];
  }
};

export const saveMappingsToStorage = (key: string, mappings: FieldMapping[]) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(mappings));
  } catch (error) {
    console.warn("Failed to persist mappings", error);
  }
};

export const clearMappingsFromStorage = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("Failed to clear mappings", error);
  }
};
