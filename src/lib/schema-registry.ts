import { type SchemaField, type SchemaObjectOption } from "@/types/schema";

type RawSchemaFile = {
  objects?: Record<string, Record<string, string>>;
};

type RawFieldMap = Map<string, string>;

type RawObjectDefinition = {
  id: string;
  name: string;
  fields: RawFieldMap;
};

type SystemEntry = {
  key: string;
  displayName: string;
  aliases: Set<string>;
  objectsById: Map<string, RawObjectDefinition>;
  objectsByName: Map<string, string>;
};

type SchemaRegistry = Map<string, SystemEntry>;

const schemaModules = import.meta.glob("../../schemes/**/*.json", { eager: true }) as Record<string, RawSchemaFile>;

const registry: SchemaRegistry = buildRegistry(schemaModules);

function buildRegistry(modules: Record<string, RawSchemaFile>): SchemaRegistry {
  const systems: SchemaRegistry = new Map();

  Object.entries(modules).forEach(([path, module]) => {
    const objects = module.objects;
    if (!objects || Object.keys(objects).length === 0) {
      return;
    }

    const { baseKey, displayName, aliases } = extractSystemInfo(path);
    const key = baseKey;

    let system = systems.get(key);
    if (!system) {
      system = {
        key,
        displayName,
        aliases: new Set([key, ...aliases]),
        objectsById: new Map(),
        objectsByName: new Map(),
      };
      systems.set(key, system);
    } else {
      aliases.forEach((alias) => system!.aliases.add(alias));
    }

    Object.entries(objects).forEach(([objectName, fields]) => {
      const objectId = ensureObjectId(system!, objectName);
      let objectEntry = system!.objectsById.get(objectId);

      if (!objectEntry) {
        objectEntry = {
          id: objectId,
          name: objectName,
          fields: new Map(),
        };
        system!.objectsById.set(objectId, objectEntry);
        system!.objectsByName.set(normalize(objectName), objectId);
      }

      Object.entries(fields ?? {}).forEach(([fieldName, rawType]) => {
        if (!objectEntry!.fields.has(fieldName)) {
          objectEntry!.fields.set(fieldName, rawType);
        }
      });
    });
  });

  return systems;
}

function ensureObjectId(system: SystemEntry, objectName: string): string {
  const baseSlug = toSlug(objectName);
  let slug = baseSlug;
  let counter = 2;

  while (system.objectsById.has(slug) && system.objectsById.get(slug)?.name !== objectName) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
}

function extractSystemInfo(path: string): { baseKey: string; displayName: string; aliases: string[] } {
  const parts = path.split("/");
  const folderName = parts[parts.length - 2] ?? "";
  const tokens = folderName.split("_");
  const baseToken = tokens[0] ?? folderName;
  const baseKey = normalize(baseToken);
  const displayName = humanize(baseToken);
  const aliasTokens = [normalize(folderName)];
  if (tokens.length > 1) {
    aliasTokens.push(normalize(tokens.slice(0, 2).join(" ")));
  }
  return {
    baseKey,
    displayName,
    aliases: aliasTokens,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanize(value: string): string {
  if (!value) return "";
  const withSpaces = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withSpaces) return "";

  const upper = withSpaces.toUpperCase();
  if (upper === "ID" || upper === "GID") {
    return upper;
  }

  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function findSystem(systemName: string): SystemEntry | null {
  if (!systemName) return null;
  const normalized = normalize(systemName);

  if (!normalized) return null;

  for (const entry of registry.values()) {
    if (entry.aliases.has(normalized)) {
      return entry;
    }

    if (normalized.startsWith(entry.key) || entry.key.startsWith(normalized)) {
      return entry;
    }
  }

  return null;
}

function sanitizeRawType(rawType: string | undefined): string {
  if (!rawType) return "";
  const trimmed = rawType.trim();
  if (!trimmed) return "";

  const unionParts = trimmed
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && part !== "null" && part !== "undefined" && part !== "nil");

  if (unionParts.length === 0) {
    return "";
  }

  if (unionParts.length === 1) {
    return unionParts[0];
  }

  const preferredPrimitive = unionParts.find((part) => primitiveTypeFor(part) !== null);
  if (preferredPrimitive) {
    return preferredPrimitive;
  }

  return unionParts[0];
}

type PrimitiveFieldType = Exclude<SchemaField["type"], "array" | "object">;

function primitiveTypeFor(typeName: string): PrimitiveFieldType | null {
  const normalized = typeName.toLowerCase();

  if (["string", "text", "uuid", "url", "uri", "key", "id", "gid"].includes(normalized)) {
    return "text";
  }

  if (["int", "integer", "long", "number", "float", "double", "decimal"].includes(normalized)) {
    return "number";
  }

  if (["bool", "boolean"].includes(normalized)) {
    return "boolean";
  }

  if (["date", "datetime", "time", "timestamp"].includes(normalized)) {
    return "date";
  }

  if (normalized === "enum") {
    return "enum";
  }

  return null;
}

function resolveObjectFields(system: SystemEntry, objectId: string, visited: Set<string> = new Set()): SchemaField[] {
  if (!objectId) return [];
  if (visited.has(objectId)) {
    return [];
  }

  const entry = system.objectsById.get(objectId);
  if (!entry) {
    return [];
  }

  const nextVisited = new Set(visited);
  nextVisited.add(objectId);

  const fields: SchemaField[] = Array.from(entry.fields.entries()).map(([fieldName, rawType]) =>
    resolveField(system, fieldName, rawType, nextVisited)
  );

  return fields.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveField(system: SystemEntry, fieldName: string, rawType: string, visited: Set<string>): SchemaField {
  const name = humanize(fieldName) || fieldName;
  const sanitizedType = sanitizeRawType(rawType);

  if (!sanitizedType) {
    return { id: fieldName, name, type: "text" };
  }

  const primitiveType = primitiveTypeFor(sanitizedType);
  if (primitiveType) {
    return { id: fieldName, name, type: primitiveType };
  }

  if (sanitizedType.endsWith("[]")) {
    const elementType = sanitizedType.slice(0, -2).trim();
    const arrayPrimitive = primitiveTypeFor(elementType);

    if (arrayPrimitive) {
      return { id: fieldName, name, type: "array" };
    }

    const nestedObjectId = findObjectId(system, elementType);
    const children = nestedObjectId ? resolveObjectFields(system, nestedObjectId, visited) : [];

    return {
      id: fieldName,
      name,
      type: "array",
      children,
    };
  }

  const nestedObjectId = findObjectId(system, sanitizedType);
  if (nestedObjectId) {
    const children = resolveObjectFields(system, nestedObjectId, visited);
    return {
      id: fieldName,
      name,
      type: "object",
      ...(children.length > 0 ? { children } : {}),
    };
  }

  return { id: fieldName, name, type: "text" };
}

function findObjectId(system: SystemEntry, typeName: string): string | undefined {
  const normalizedType = normalize(typeName);
  if (!normalizedType) return undefined;

  if (system.objectsByName.has(normalizedType)) {
    return system.objectsByName.get(normalizedType);
  }

  const slugCandidate = toSlug(typeName);
  if (system.objectsById.has(slugCandidate)) {
    return slugCandidate;
  }

  for (const [objectId, objectEntry] of system.objectsById.entries()) {
    if (normalize(objectEntry.name) === normalizedType) {
      return objectId;
    }
  }

  return undefined;
}

export function getSystemObjectOptions(systemName: string): SchemaObjectOption[] {
  const system = findSystem(systemName);
  if (!system) return [];

  return Array.from(system.objectsById.values())
    .map((object) => ({ id: object.id, name: humanize(object.name) || object.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getFieldsForSystemObject(systemName: string, objectId: string): SchemaField[] {
  const system = findSystem(systemName);
  if (!system) return [];

  if (!objectId) return [];

  const normalizedId = system.objectsById.has(objectId) ? objectId : findObjectId(system, objectId);
  if (!normalizedId) return [];

  return resolveObjectFields(system, normalizedId);
}

export function getRegisteredSystems(): string[] {
  return Array.from(registry.values())
    .map((system) => system.displayName)
    .sort((a, b) => a.localeCompare(b));
}
