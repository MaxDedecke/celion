// src/agents/authFlow/parser.ts

import { extractJson } from "../openai/message";
import type { AuthFlowResult } from "./types";

export const parseAuthFlowResponse = (text: string): AuthFlowResult => {
  const jsonStr = extractJson(text);
  const parsed = JSON.parse(jsonStr);

  // Neue Agent-Felder mit Fallbacks für Abwärtskompatibilität
  return {
    // Neue deterministische Felder
    valid: parsed.valid ?? Boolean(parsed.authenticated),
    authType: parsed.authType ?? parsed.auth_method ?? null,
    apiType: parsed.apiType ?? null,
    normalizedHeaders: parsed.normalizedHeaders ?? parsed.auth_headers ?? {},
    probe: parsed.probe ?? {
      method: "GET",
      endpoint: "",
      status: null,
    },
    schemeUsed: parsed.schemeUsed ?? null,
    
    // Neues Feld für Fehler-Hinweise
    errorHint: parsed.errorHint ?? null,
    
    // Alte Felder für Abwärtskompatibilität
    system: parsed.system ?? null,
    base_url: parsed.base_url ?? null,
    authenticated: Boolean(parsed.authenticated ?? parsed.valid),
    auth_method: parsed.auth_method ?? parsed.authType ?? null,
    auth_headers: parsed.auth_headers ?? parsed.normalizedHeaders ?? {},
    recommended_probe: parsed.recommended_probe ?? null,
    explanation: parsed.explanation ?? "",
    raw_output: parsed.raw_output ?? parsed,
    reasoning: parsed.reasoning ?? null,
    probe_result: parsed.probe_result ?? null,
    summary: parsed.summary ?? null,
    error_message: parsed.error_message ?? parsed.errorHint ?? null,
  };
};
