export type SchemaFieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "array"
  | "object";

export interface SchemaField {
  id: string;
  name: string;
  type: SchemaFieldType;
  children?: SchemaField[];
}

export interface SchemaObjectOption {
  id: string;
  name: string;
}
