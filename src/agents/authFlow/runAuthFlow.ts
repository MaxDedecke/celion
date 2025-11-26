// src/agents/authFlow/runAuthFlow.ts

import { httpRequestTool as http_request } from "../openai/httpTool";
import type { HttpRequestParams } from "@/types/agents";
import { readSchemeFile } from "@/tools/readSchemeFile";
import type { AuthFlowResult, AuthSchemeDefinition, AuthHeaders } from "./types";

export type RunAuthFlowParams = {
  system: string; // z.B. "Jira Cloud", "Asana", "Monday.com"
  baseUrl: string;
  apiToken?: string;
  email?: string;
  password?: string;
};

const normalizeSystemName = (systemName: string): string =>
  systemName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

const resolveSchemePath = (normalizedSystem: string) => `/schemes/${normalizedSystem}.json`;

const normalizeHeaderKey = (key: string): string => {
  if (!key) return key;
  const lower = key.toLowerCase();
  if (lower === "contenttype" || lower === "content-type") return "Content-Type";
  if (lower === "accept") return "Accept";
  return key
    .replace(/_/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/(^|-)([a-z])/g, (_match, sep, char) => `${sep}${char.toUpperCase()}`);
};

const substituteCredentialToken = (token: string, credentials: Record<string, string | undefined>): string => {
  const normalized = token.toLowerCase();
  switch (normalized) {
    case "token":
      return credentials.apiToken || credentials.password || "";
    case "apitoken":
      return credentials.apiToken || "";
    case "email":
      return credentials.email || "";
    case "password":
      return credentials.password || "";
    default:
      return credentials[token] || "";
  }
};

const replaceBasicPlaceholders = (value: string, credentials: Record<string, string | undefined>) =>
  value.replace(/<([A-Za-z0-9_]+)>/g, (_match, token) => substituteCredentialToken(token, credentials));

const buildAuthHeader = (scheme: AuthSchemeDefinition, credentials: Record<string, string | undefined>): AuthHeaders => {
  const template = scheme.auth.headerTemplate;
  const [rawKey, ...valueParts] = template.split(":");
  const headerKey = normalizeHeaderKey(rawKey.trim());
  const rawValue = valueParts.join(":").trim();

  const valueWithBase64 = rawValue.replace(/<BASE64\(([^)]+)\)>/gi, (_match, inner) => {
    const replacedInner = inner.replace(/([A-Za-z0-9_]+)/g, token => substituteCredentialToken(token, credentials));
    return btoa(replacedInner);
  });

  const headerValue = replaceBasicPlaceholders(valueWithBase64, credentials);

  return { [headerKey]: headerValue };
};

const mergeHeaders = (scheme: AuthSchemeDefinition, authHeader: AuthHeaders): AuthHeaders => {
  const normalized: AuthHeaders = {};

  const addHeaderRecord = (record?: Record<string, string>) => {
    if (!record) return;
    for (const [key, value] of Object.entries(record)) {
      normalized[normalizeHeaderKey(key)] = value;
    }
  };

  addHeaderRecord(scheme.headers);
  addHeaderRecord(authHeader);

  return normalized;
};

const buildProbeRequest = (
  scheme: AuthSchemeDefinition,
  baseUrl: string,
  headers: AuthHeaders,
): HttpRequestParams & { body?: unknown } => {
  const method = (scheme.auth.probeMethod || "GET").toUpperCase();
  const endpoint = scheme.auth.probeEndpoint.startsWith("/")
    ? scheme.auth.probeEndpoint
    : `/${scheme.auth.probeEndpoint}`;
  const url = `${baseUrl.replace(/\/$/, "")}${endpoint}`;

  return {
    method,
    url,
    headers,
    ...(scheme.auth.probeBody !== undefined ? { body: scheme.auth.probeBody } : { body: null }),
  };
};

export const runAuthFlow = async (params: RunAuthFlowParams): Promise<AuthFlowResult> => {
  const normalizedSystem = normalizeSystemName(params.system);
  const schemePath = resolveSchemePath(normalizedSystem);
  const scheme = await readSchemeFile<AuthSchemeDefinition>({ path: schemePath });

  const credentials = {
    email: params.email,
    apiToken: params.apiToken,
    password: params.password,
  };

  const authHeader = buildAuthHeader(scheme, credentials);
  const normalizedHeaders = mergeHeaders(scheme, authHeader);
  const request = buildProbeRequest(scheme, params.baseUrl, normalizedHeaders);

  const response = await http_request({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body ?? null,
  });

  const valid = response.status === scheme.auth.successStatus;

  return {
    valid,
    authType: scheme.auth.type || null,
    apiType: scheme.apiType || null,
    normalizedHeaders,
    probe: {
      method: scheme.auth.probeMethod || "GET",
      endpoint: scheme.auth.probeEndpoint,
      status: response.status,
    },
    schemeUsed: normalizedSystem,

    // Abwärtskompatibilität für bestehende UI-Pfade
    system: scheme.system || params.system || null,
    base_url: params.baseUrl,
    authenticated: valid,
    auth_method: scheme.auth.type || null,
    auth_headers: normalizedHeaders,
    recommended_probe: {
      method: request.method,
      url: request.url,
      headers: request.headers,
      requires_auth: true,
      api_format: scheme.apiType?.toLowerCase() === "graphql" ? "graphql" : "rest_json",
      graphql: null,
      body: request.body ?? null,
    },
    explanation: valid
      ? "Authentifizierung erfolgreich gemäß Schema-Definition."
      : "Authentifizierung fehlgeschlagen gemäß Schema-Definition.",
    raw_output: response,
    probe_result: response,
  };
};
