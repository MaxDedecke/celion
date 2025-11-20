// src/agents/authFlow/parser.ts

import { extractJson } from "../openai/message";
import type { AuthFlowResult } from "./types";

export const parseAuthFlowResponse = (text: string): AuthFlowResult => {
  const jsonStr = extractJson(text);
  const parsed = JSON.parse(jsonStr);

  // Du kannst hier optional noch Validierung einziehen
  return {
    system: parsed.system ?? null,
    base_url: parsed.base_url ?? null,
    authenticated: Boolean(parsed.authenticated),
    auth_method: parsed.auth_method ?? null,
    auth_headers: parsed.auth_headers ?? {},
    recommended_probe: parsed.recommended_probe,
    explanation: parsed.explanation ?? "",
    raw_output: parsed.raw_output ?? parsed,
  };
};
