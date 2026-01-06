// src/agents/authFlow/types.ts

export type AgentConfig = {
  instructions: string;
  tools: any[];
};

export type AuthHeaders = Record<string, string>;

export type AuthProbeConfig = {
  method: string;
  url: string;
  headers: AuthHeaders;
  requires_auth: boolean;
  api_format: "rest_json" | "graphql" | "form" | "xml";
  graphql?: {
    query: string;
    operation_name?: string | null;
    variables?: Record<string, any> | null;
  } | null;
  body?: unknown;
};

export type AuthFlowResult = {
  // Neues deterministisches Ergebnis
  valid: boolean;
  authType: string | null;
  apiType: string | null;
  normalizedHeaders: AuthHeaders;
  probe: {
    method: string;
    endpoint: string;
    status: number | null;
  };
  schemeUsed: string | null;
  
  // Neues Feld für Fehler-Hinweise vom Agenten
  errorHint?: string | null;

  // Abwärtskompatible Felder
  system?: string | null;
  base_url?: string | null;
  authenticated?: boolean;
  auth_method?: string | null;
  auth_headers?: AuthHeaders;
  recommended_probe?: AuthProbeConfig | null;
  explanation?: string;
  raw_output?: any;
  reasoning?: string | null;
  probe_result?: any | null;
  summary?: string | null;
  error_message?: string | null;
};

export type AuthSchemeDefinition = {
  system: string;
  apiType: string;
  baseUrlPattern?: string;
  apiBaseUrl?: string;
  auth: {
    type: string;
    headerTemplate: string;
    requiresToken?: boolean;
    requiresEmail?: boolean;
    requiresApiToken?: boolean;
    probeEndpoint: string;
    probeMethod?: string;
    probeBody?: unknown;
    successStatus: number;
  };
  headers?: Record<string, string>;
};