export interface SystemDetectionEvidence {
  headers?: string[];
  status_codes?: Record<string, number>;
  raw_response?: string;
  raw?: unknown;
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

export interface AuthFlowResult {
  system: string | null;
  base_url: string | null;
  recommended_probe: AuthFlowRecommendation | null;
  reasoning: string | null;
  probe_result: import("@/tools/credentialProbe").CredentialProbeResult | null;
  authenticated: boolean | null;
  summary: string | null;
  error_message: string | null;
  raw_output: string;
}

export interface AuthFlowStepResult {
  source: AuthFlowResult | null;
  target: AuthFlowResult | null;
}

export interface SchemaObjectField {
  name: string;
  type?: string | null;
  path?: string | null;
  sample_value?: unknown;
}

export interface SchemaObjectDefinition {
  name: string;
  endpoint: string;
  success: boolean;
  status?: number | null;
  fields: SchemaObjectField[];
  sample_count?: number | null;
  error?: string | null;
}

export interface SchemaDiscoveryResult {
  system: string | null;
  base_url: string | null;
  objects: SchemaObjectDefinition[];
  summary?: string | null;
  raw_output: string;
  error_message?: string | null;
}

