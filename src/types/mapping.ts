export type MappingType = "direct" | "collection";

interface BaseFieldMapping {
  id: string;
  targetFieldId: string;
  mappingType: MappingType;
  description?: string;
  enhancements?: string[];
  updatedAt?: string;
}

export interface DirectFieldMapping extends BaseFieldMapping {
  mappingType: "direct";
  sourceFieldId: string;
}

export interface CollectionFieldMapping extends BaseFieldMapping {
  mappingType: "collection";
  sourceFieldId: string;
  collectionItemFieldId: string;
  joinWith?: string;
}

export type FieldMapping = DirectFieldMapping | CollectionFieldMapping;
