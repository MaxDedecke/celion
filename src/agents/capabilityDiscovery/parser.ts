// src/agents/capabilityDiscovery/parser.ts

import { extractJson } from "../openai/message";
import type { CapabilityDiscoveryResult, ApiSpecAnalysis } from "@/types/agents";

export const parseCapabilityDiscoveryResponse = (
  rawText: string
): CapabilityDiscoveryResult => {
  const jsonStr = extractJson(rawText);

  let parsed: Partial<ApiSpecAnalysis>;
  try {
    parsed = JSON.parse(jsonStr) as Partial<ApiSpecAnalysis>;
  } catch {
    return {
      api_spec_found: false,
      spec_url: "",
      entities: [],
      endpoints: [],
      schemas: {},
      authentication: {},
      pagination: {},
      probe_results: {},
      limitations: [],
      summary: "",
      raw_output: rawText,
    };
  }

  return {
    api_spec_found: parsed.api_spec_found ?? false,
    spec_url: typeof parsed.spec_url === "string" ? parsed.spec_url : "",
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : [],
    schemas: parsed.schemas && typeof parsed.schemas === "object" ? parsed.schemas : {},
    authentication:
      parsed.authentication && typeof parsed.authentication === "object"
        ? parsed.authentication
        : {},
    pagination:
      parsed.pagination && typeof parsed.pagination === "object" ? parsed.pagination : {},
    probe_results:
      parsed.probe_results && typeof parsed.probe_results === "object"
        ? parsed.probe_results
        : {},
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    raw_output: rawText,
  };
};
