// src/agents/capabilityDiscovery/runCapabilityDiscovery.ts

import { httpRequestTool as httpClient } from "../openai/httpTool";
import {
  buildAuthHeaders,
  getCapabilityDiscoveryConfig,
  mergeSchemeHeaders,
  normalizeSystemName,
  resolveApiBaseUrl,
  resolveSchemePath,
} from "./assistant";
import { buildUrlWithQuery, hasPathPlaceholders } from "./prompt";
import { extractFirstArray, extractHasMoreFlag, extractNextCursor, normalizeResponseBody } from "./parser";
import { createConversation } from "../openai/conversation";
import { createResponse } from "../openai/run";
import { extractJson, extractMessageText } from "../openai/message";
import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import type { CapabilityDiscoveryCredentials } from "./assistant";
import type { CapabilityDiscoveryResult, HttpResponse } from "../../types/agents";
import type { DiscoveryPaginationConfig, SchemeDefinition } from "../../types/schemes";
import type { OpenAiResponseToolCall, OpenAiResponseMessage } from "../openai/types";
import { readJsonFile } from "../../tools/fileReader";

const _internalRunCapabilityDiscovery = async (
  baseUrl: string,
  system: string,
  apiToken: string,
  email?: string,
  password?: string,
): Promise<CapabilityDiscoveryResult> => {
  if (!baseUrl?.trim()) {
    throw new Error("Capability Agent benötigt eine Base-URL");
  }

  const normalizedSystem = normalizeSystemName(system);
  const schemePath = resolveSchemePath(normalizedSystem);
  const scheme = await readJsonFile<SchemeDefinition>({ path: schemePath });

  const credentials: CapabilityDiscoveryCredentials = {
    apiToken,
    email,
    password,
  };

  const authHeaders = buildAuthHeaders(scheme, credentials);
  const headers = mergeSchemeHeaders(scheme, authHeaders);
  const resolvedBaseUrl = resolveApiBaseUrl(scheme, baseUrl);

  if (scheme.apiType?.toUpperCase() === "GRAPHQL" || scheme.discovery?.graphqlQueryObjects) {
    return runGraphqlDiscovery(scheme, resolvedBaseUrl, headers);
  }

  const endpoints = scheme.discovery?.endpoints ?? {};
  const pagination = scheme.discovery?.pagination ?? undefined;

  const objects: CapabilityDiscoveryResult["objects"] = {};

  for (const [resourceName, endpoint] of Object.entries(endpoints)) {
    const { count, error } = await fetchRestResource(resolvedBaseUrl, endpoint, headers, pagination);
    objects[resourceName] = { count, ...(error ? { error } : {}) };
  }

  return {
    system: scheme.system || system,
    objects,
    raw_output: null,
  };
};

const MAX_PAGES = 50;
const DEFAULT_LIMIT = 50;

const getHeaderValue = (headers: Record<string, string> | undefined, key: string): string | null => {
  if (!headers) return null;
  const lowerKey = key.toLowerCase();

  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey) {
      return value;
    }
  }

  return null;
};

const normalizeLimit = (limit?: number) => (Number.isFinite(limit) && (limit ?? 0) > 0 ? Math.floor(limit as number) : DEFAULT_LIMIT);

const evaluatePage = (response: HttpResponse) => {
  const normalizedBody = normalizeResponseBody(response.body);
  const items = extractFirstArray(normalizedBody);
  const cursor = extractNextCursor(normalizedBody);
  const hasMore = extractHasMoreFlag(normalizedBody);

  return { itemsCount: items.length, cursor, hasMore };
};

type EvaluatedPage = {
  response: HttpResponse;
  itemsCount: number;
  cursor: string | null;
  hasMore: boolean | null;
  error?: string | null;
};

const performRequest = async (
  url: string,
  headers: Record<string, string>,
): Promise<EvaluatedPage> => {
  const result = await httpClient({ method: "GET", url, headers });

  if (result.error) {
    return {
      response: { ...result, body: normalizeResponseBody(result.body) },
      itemsCount: 0,
      cursor: null,
      hasMore: null,
      error: result.error,
    };
  }

  if (result.status && result.status >= 400) {
    return {
      response: { ...result, body: normalizeResponseBody(result.body) },
      itemsCount: 0,
      cursor: null,
      hasMore: null,
      error: result.error || `HTTP Status ${result.status}`,
    };
  }

  const { itemsCount, cursor, hasMore } = evaluatePage(result);
  return { response: { ...result, body: normalizeResponseBody(result.body) }, itemsCount, cursor, hasMore, error: null };
};

const fetchOffsetPagination = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
  pagination: DiscoveryPaginationConfig | undefined,
): Promise<{ count: number; error?: string | null }> => {
  const limit = normalizeLimit(pagination?.defaultLimit);
  const startParam = pagination?.paramStart || pagination?.paramOffset || "offset";
  const limitParam = pagination?.paramLimit || "limit";

  let total = 0;
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const url = buildUrlWithQuery(baseUrl, endpoint, {
      [startParam]: offset,
      [limitParam]: limit,
    });

    const result = await performRequest(url, headers);
    if (result.error) {
      return { count: total, error: result.error };
    }

    total += result.itemsCount;

    if (result.itemsCount < limit) {
      break;
    }

    offset += limit;
  }

  return { count: total };
};

const fetchPagePagination = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
  pagination: DiscoveryPaginationConfig | undefined,
): Promise<{ count: number; error?: string | null }> => {
  const limit = normalizeLimit(pagination?.defaultLimit);
  const pageParam = pagination?.paramPage || "page";
  const limitParam = pagination?.paramLimit || "limit";

  let total = 0;
  let page = 1;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const url = buildUrlWithQuery(baseUrl, endpoint, {
      [pageParam]: page,
      [limitParam]: limit,
    });

    const result = await performRequest(url, headers);
    if (result.error) {
      return { count: total, error: result.error };
    }

    total += result.itemsCount;

    if (result.itemsCount < limit) {
      break;
    }

    page += 1;
  }

  return { count: total };
};

const fetchCursorPagination = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
  pagination: DiscoveryPaginationConfig | undefined,
): Promise<{ count: number; error?: string | null }> => {
  const limit = normalizeLimit(pagination?.defaultLimit);
  const cursorParam = pagination?.paramCursor || "cursor";
  const limitParam = pagination?.paramLimit || "limit";

  let total = 0;
  let cursor: string | null = null;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const url = buildUrlWithQuery(baseUrl, endpoint, {
      [limitParam]: limit,
      ...(cursor ? { [cursorParam]: cursor } : {}),
    });

    const result = await performRequest(url, headers);
    if (result.error) {
      return { count: total, error: result.error };
    }

    total += result.itemsCount;
    const hasMore = result.hasMore;
    cursor = result.cursor;

    if (!cursor || hasMore === false || result.itemsCount < limit) {
      break;
    }
  }

  return { count: total };
};

const fetchContinuationPagination = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
  pagination: DiscoveryPaginationConfig | undefined,
): Promise<{ count: number; error?: string | null }> => {
  const limit = normalizeLimit(pagination?.defaultLimit);
  const limitParam = pagination?.paramLimit || "limit";
  const continuationHeader = pagination?.headerContinuation;

  let total = 0;
  let continuationToken: string | null = null;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const requestHeaders = continuationToken && continuationHeader
      ? { ...headers, [continuationHeader]: continuationToken }
      : headers;

    const url = buildUrlWithQuery(baseUrl, endpoint, {
      [limitParam]: limit,
      ...(continuationToken ? { continuationToken } : {}),
    });

    const result = await performRequest(url, requestHeaders);
    if (result.error) {
      return { count: total, error: result.error };
    }

    total += result.itemsCount;

    if (!continuationHeader) {
      if (result.itemsCount < limit) {
        break;
      }
      continue;
    }

    continuationToken = getHeaderValue(result.response.headers, continuationHeader);

    if (!continuationToken || result.itemsCount < limit) {
      break;
    }
  }

  return { count: total };
};

const fetchSinglePage = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
): Promise<{ count: number; error?: string | null }> => {
  const url = buildUrlWithQuery(baseUrl, endpoint);
  const result = await performRequest(url, headers);
  if (result.error) {
    return { count: result.itemsCount, error: result.error };
  }

  return { count: result.itemsCount };
};

const fetchRestResource = async (
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>,
  pagination: DiscoveryPaginationConfig | undefined,
): Promise<{ count: number; error?: string | null }> => {
  if (!endpoint) {
    return { count: 0, error: "Kein Endpoint definiert." };
  }

  if (hasPathPlaceholders(endpoint)) {
    return { count: 0, error: "Endpoint benötigt Pfadparameter und wird übersprungen." };
  }

  if (!pagination || pagination.type === "none" || pagination.type === null) {
    return fetchSinglePage(baseUrl, endpoint, headers);
  }

  switch (pagination.type) {
    case "offset":
    case "offset_limit":
    case "startAt_maxResults":
    case "page_size_offset":
    case "skip_top":
      return fetchOffsetPagination(baseUrl, endpoint, headers, pagination);
    case "page":
    case "page_limit":
    case "page_per_page":
      return fetchPagePagination(baseUrl, endpoint, headers, pagination);
    case "cursor":
      return fetchCursorPagination(baseUrl, endpoint, headers, pagination);
    case "continuationToken":
      return fetchContinuationPagination(baseUrl, endpoint, headers, pagination);
    default:
      return fetchSinglePage(baseUrl, endpoint, headers);
  }
};

const collectGraphqlCounts = (
  payload: unknown,
  objectTypes: string[] | undefined,
): Record<string, number> => {
  const results: Record<string, number> = {};
  if (!objectTypes || objectTypes.length === 0) {
    return results;
  }

  for (const type of objectTypes) {
    results[type] = 0;
  }

  const visit = (value: unknown, path: string[] = []) => {
    if (!value) return;

    if (Array.isArray(value)) {
      const lastKey = path[path.length - 1];
      if (lastKey && results[lastKey] !== undefined) {
        results[lastKey] += value.length;
      }
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([key, nested]) => visit(nested, [...path, key]));
    }
  };

  visit(payload);
  return results;
};

const runGraphqlDiscovery = async (
  scheme: SchemeDefinition,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<CapabilityDiscoveryResult> => {
  const discovery = scheme.discovery;
  const queries = discovery?.graphqlQueryObjects ?? [];
  const objectTypes = discovery?.objectTypes ?? [];
  const endpoint = scheme.auth?.probeEndpoint || "/graphql";
  const method = scheme.auth?.probeMethod || "POST";

  const objects: Record<string, { count: number; error?: string | null }> = {};
  objectTypes.forEach((type) => {
    objects[type] = { count: 0 };
  });

  for (const query of queries) {
    const response = await httpClient({
      method,
      url: buildUrlWithQuery(baseUrl, endpoint),
      headers,
      body: { query },
    });

    if (response.status && response.status >= 400) {
      for (const type of objectTypes) {
        objects[type] = {
          count: objects[type]?.count ?? 0,
          error: response.error || `GraphQL Antwort mit Status ${response.status}`,
        };
      }
      continue;
    }

    const normalizedBody = normalizeResponseBody(response.body);
    const counts = collectGraphqlCounts(normalizedBody, objectTypes);

    for (const [type, count] of Object.entries(counts)) {
      objects[type] = { count: (objects[type]?.count ?? 0) + count };
    }
  }

  return {
    system: scheme.system,
    objects,
    raw_output: null,
  };
};

const executeToolCall = async (
  call: OpenAiResponseToolCall,
): Promise<{ tool_call_id: string; output: string }> => {
  const { id, function: fn } = call;

  if (fn.name === "discover_capabilities_from_scheme") {
    let args: {
      baseUrl: string;
      system: string;
      apiToken: string;
      email?: string;
      password?: string;
    } = { baseUrl: "", system: "", apiToken: "" };
    try {
      args = JSON.parse(fn.arguments ?? "{}");
    } catch {
      /* ignore */
    }

    const output = await _internalRunCapabilityDiscovery(
      args.baseUrl,
      args.system,
      args.apiToken,
      args.email,
      args.password,
    );
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  return { tool_call_id: id, output: JSON.stringify({ error: `Unknown tool: ${fn.name}` }) };
};

export const runCapabilityDiscovery = async (
  baseUrl: string,
  system: string,
  apiToken: string,
  email?: string,
  password?: string,
): Promise<CapabilityDiscoveryResult> => {
  const { apiKey, baseUrl: openAiBaseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const conversationId = await createConversation(openAiBaseUrl, headers);
  const { instructions, tools } = getCapabilityDiscoveryConfig();

  const prompt = `Führe die Fähigkeitserkennung für das System "${system}" unter der URL "${baseUrl}" durch.`;
  const initialInput = [
    { role: "system", content: instructions },
    { role: "user", content: prompt },
  ];

  let response = await createResponse(openAiBaseUrl, headers, conversationId, {
    model: "gpt-4.1-mini",
    input: initialInput,
    tools,
  });

  while (response.output.some(o => o.type === "tool_call")) {
    const toolCalls = response.output.filter(
      (o): o is OpenAiResponseToolCall => o.type === "tool_call",
    );

    const toolOutputs = await Promise.all(
      toolCalls.map(async call => {
        const output = await executeToolCall(call);
        return {
          type: "function_call_output" as const,
          tool_call_id: output.tool_call_id,
          output: output.output,
        };
      }),
    );

    response = await createResponse(openAiBaseUrl, headers, conversationId, {
      model: "gpt-4.1-mini",
      input: toolOutputs,
    });
  }

  const message = response.output.find((o): o is OpenAiResponseMessage => o.type === "message");

  if (message) {
    const rawText = extractMessageText({ ...message, id: "", role: "assistant" });
    const jsonText = extractJson(rawText);
    try {
      return JSON.parse(jsonText) as CapabilityDiscoveryResult;
    } catch {
      // If parsing fails, it might be a text response. We can wrap it.
      return {
        system,
        objects: {},
        raw_output: rawText,
      };
    }
  }

  throw new Error("Capability Discovery returned no message.");
};
