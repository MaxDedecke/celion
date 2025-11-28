// src/agents/capabilityDiscovery/parser.ts

const ARRAY_CANDIDATE_KEYS = [
  "data",
  "values",
  "results",
  "items",
  "records",
  "elements",
  "issues",
  "projects",
  "users",
  "tasks",
];

export const normalizeResponseBody = (body: unknown): unknown => {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  return body;
};

export const extractFirstArray = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    for (const key of ARRAY_CANDIDATE_KEYS) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value;
      }
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
};

export const extractNextCursor = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.next_cursor === "string") {
    return record.next_cursor;
  }

  if (typeof record.nextPageToken === "string") {
    return record.nextPageToken;
  }

  if (typeof record.cursor === "string") {
    return record.cursor;
  }

  if (record.pagination && typeof record.pagination === "object") {
    const nested = record.pagination as Record<string, unknown>;
    if (typeof nested.next === "string") {
      return nested.next;
    }
    if (typeof nested.cursor === "string") {
      return nested.cursor;
    }
  }

  return null;
};

export const extractHasMoreFlag = (payload: unknown): boolean | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.has_more === "boolean") {
    return record.has_more;
  }

  if (typeof record.hasMore === "boolean") {
    return record.hasMore;
  }

  return null;
};
