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

export interface AuthFlowRecommendation {
  method: string;
  url: string;
  requires_auth: boolean;
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

