export interface SystemDetectionEvidence {
  headers?: string[];
  status_codes?: Record<string, number>;
  raw_response?: string;
  raw?: unknown;
  request_url?: string;
  method?: string;
  used_headers?: string[];
  timestamp?: string;
  redirects?: Array<{ status?: number; location?: string | null; url?: string | null }>;
  [key: string]: unknown;
}

export interface SystemDetectionResult {
  systemMatchesUrl: boolean;
  apiTypeDetected: string | null;
  apiSubtype: string | null;
  recommendedBaseUrl: string | null;
  confidenceScore: number | null;
  detectionEvidence?: SystemDetectionEvidence;
  rawOutput?: string;
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
  // Neues deterministisches Ergebnisformat
  valid?: boolean;
  authType?: string | null;
  apiType?: string | null;
  normalizedHeaders?: Record<string, string>;
  probe?: {
    method: string;
    endpoint: string;
    status: number | null;
  };
  schemeUsed?: string | null;

  // Bestehende Felder für Abwärtskompatibilität im UI
  system?: string | null;
  base_url?: string | null;
  authenticated?: boolean;
  auth_method?: string | null;
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

export interface SmartDiscoveryParams extends HttpRequestParams {
  paginationConfig?: any | null; // Using any to avoid circular dependency or complex import if needed
  discoveryBrake?: boolean;
}

export interface SmartDiscoveryResponse {
  totalCount: number;
  pagesFetched: number;
  sampleData: any;
  status: number | null;
  error?: string | null;
}

export interface HttpResponse {
  status: number | null;
  headers: Record<string, string>;
  body: unknown;
  error?: string | null;
  raw_response?: string;
  evidence?: SystemDetectionEvidence;
}

export interface CurlHeadProbeParams {
  url: string;
  headers?: Record<string, string>;
  follow_redirects?: boolean;
}

export interface CurlHeadProbeResponse {
  status: number | null;
  headers: Record<string, string>;
  redirects: Array<{ status?: number; location?: string | null; url?: string | null }>;
  final_url: string | null;
  raw_response: string | null;
  error?: string | null;
}

export type AgentName = 
  | 'runSystemDetection' 
  | 'runAuthFlow' 
  | 'runCapabilityDiscovery';

export interface CapabilityObjectInfo {
  count: number;
  error?: string | null;
}

export interface CapabilityDiscoveryResult {
  system: string;
  objects: Record<string, CapabilityObjectInfo>;
  raw_output?: string | null;
}

export interface DataStagingResult {
  objects_staged: number;
  expected_count: number;
  accuracy: number;
  summary?: string | null;
  raw_json?: Record<string, unknown> | null;
}

