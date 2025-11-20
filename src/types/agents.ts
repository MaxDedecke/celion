export interface SystemDetectionEvidence {
  headers?: string[];
  status_codes?: Record<string, number>;
  raw_response?: string;
  raw?: unknown;
  request_url?: string;
  method?: string;
  used_headers?: string[];
  timestamp?: string;
  [key: string]: unknown;
}

export interface SystemDetectionResult {
  detected: boolean;
  system: string | null;
  api_version: string | null;
  confidence: number | null;
  base_url: string | null;
  detection_evidence: SystemDetectionEvidence;
  raw_output: string;
}

export interface SystemDetectionStepResult {
  source: SystemDetectionResult | null;
  target: SystemDetectionResult | null;
}

export type ApiRequestFormat = "rest_json" | "graphql" | "soap_xml" | "xml";

export type AuthScheme = "basic" | "bearer" | "none";

export interface GraphqlProbeConfig {
  query: string;
  operation_name?: string | null;
  variables?: Record<string, unknown> | null;
}

export interface AuthFlowRecommendation {
  method: string;
  url: string;
  requires_auth: boolean;
  api_format?: ApiRequestFormat;
  auth_scheme?: AuthScheme;
  graphql?: GraphqlProbeConfig | null;
}

export type AuthFlowResult = {
  system: string | null;
  base_url: string | null;
  authenticated: boolean;
  auth_method: string | null;

  // neue Felder
  auth_headers?: Record<string, string>;
  recommended_probe?: any;
  explanation?: string;
  raw_output?: any;

  // alte Felder für Kompatibilität (werden vom LLM gesetzt oder bleiben leer)
  reasoning?: string | null;
  probe_result?: any | null;
  summary?: string | null;
  error_message?: string | null;
};


export interface AuthFlowStepResult {
  source: AuthFlowResult | null;
  target: AuthFlowResult | null;
}

export interface HttpRequestParams {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number | null;
  headers: Record<string, string>;
  body: unknown;
  error?: string | null;
  raw_response?: string;
  evidence?: SystemDetectionEvidence;
}

export interface ApiSpecAnalysis {
  api_spec_found: boolean;
  spec_url: string;
  entities: string[];
  endpoints: string[];
  schemas: Record<string, unknown>;
  authentication: Record<string, unknown>;
  pagination: Record<string, unknown>;
  probe_results: Record<string, unknown>;
  limitations: string[];
  summary: string;
}

export interface CapabilityDiscoveryResult extends ApiSpecAnalysis {
  raw_output?: string | null;
}

