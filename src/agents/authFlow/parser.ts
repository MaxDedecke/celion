// src/agents/authFlow/parser.ts

import type { AuthFlowResult, AuthFlowRecommendation } from "@/types/agents";
import { extractJson } from "../openai/message";

type RawAuthProbe = {
  method?: unknown;
  url?: unknown;
  requires_auth?: unknown;
  api_format?: unknown;
  auth_scheme?: unknown;
  graphql?: {
    query?: unknown;
    operation_name?: unknown;
    variables?: unknown;
  };
};

type RawAuthFlowPayload = {
  system?: unknown;
  base_url?: unknown;
  reasoning?: unknown;
  recommended_probe?: RawAuthProbe | null;
};

const normalizeApiFormat = (value: unknown): AuthFlowRecommendation["api_format"] | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["rest_json", "graphql", "soap_xml", "xml"].includes(v)) {
    return v as AuthFlowRecommendation["api_format"];
  }
  return undefined;
};

const normalizeAuthScheme = (value: unknown): AuthFlowRecommendation["auth_scheme"] | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["bearer", "basic", "none"].includes(v)) {
    return v as AuthFlowRecommendation["auth_scheme"];
  }
  return undefined;
};

export const parseAuthFlowResponse = (rawText: string): AuthFlowResult => {
  const jsonStr = extractJson(rawText);

  let parsed: RawAuthFlowPayload;
  try {
    parsed = JSON.parse(jsonStr) as RawAuthFlowPayload;
  } catch {
    throw new Error(`Die Auth Flow Antwort konnte nicht als JSON interpretiert werden. Antwort: ${rawText}`);
  }

  const system =
    typeof parsed.system === "string" && parsed.system.trim().length > 0
      ? parsed.system.trim()
      : null;

  const baseUrl =
    typeof parsed.base_url === "string" && parsed.base_url.trim().length > 0
      ? parsed.base_url.trim()
      : null;

  const reasoning =
    typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
      ? parsed.reasoning.trim()
      : null;

  let recommendedProbe: AuthFlowResult["recommended_probe"] = null;

  if (parsed.recommended_probe && typeof parsed.recommended_probe === "object") {
    const probe = parsed.recommended_probe;

    const method =
      typeof probe.method === "string" && probe.method.trim().length > 0
        ? probe.method.trim().toUpperCase()
        : null;

    const url =
      typeof probe.url === "string" && probe.url.trim().length > 0
        ? probe.url.trim()
        : null;

    const requiresAuth =
      typeof probe.requires_auth === "boolean"
        ? probe.requires_auth
        : probe.requires_auth === undefined
          ? true
          : Boolean(probe.requires_auth);

    const apiFormat = normalizeApiFormat(probe.api_format);
    const authScheme = normalizeAuthScheme(probe.auth_scheme);

    let graphqlConfig: AuthFlowRecommendation["graphql"] | undefined = undefined;
    if (probe.graphql && typeof probe.graphql === "object") {
      const q = probe.graphql.query;
      const op = probe.graphql.operation_name;
      const vars = probe.graphql.variables;

      const query =
        typeof q === "string" && q.trim().length > 0 ? q.trim() : null;
      const operationName =
        typeof op === "string" && op.trim().length > 0 ? op.trim() : null;
      const variables =
        vars && typeof vars === "object" && !Array.isArray(vars) ? (vars as Record<string, unknown>) : null;

      if (query) {
        graphqlConfig = { query, operation_name: operationName ?? undefined, variables: variables ?? undefined };
      }
    }

    if (method && url) {
      recommendedProbe = {
        method,
        url,
        requires_auth: requiresAuth,
        ...(apiFormat ? { api_format: apiFormat } : {}),
        ...(authScheme ? { auth_scheme: authScheme } : {}),
        ...(graphqlConfig ? { graphql: graphqlConfig } : {}),
      };
    }
  }

  return {
    system,
    base_url: baseUrl,
    recommended_probe: recommendedProbe,
    reasoning,
    probe_result: null,
    authenticated: null,
    summary: null,
    error_message: null,
    raw_output: rawText,
  } satisfies AuthFlowResult;
};
