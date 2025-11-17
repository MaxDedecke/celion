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

export interface AuthFlowResult {
  authenticated: boolean;
  auth_method: string | null;
  permissions: string[];
  validation_evidence: Record<string, unknown>;
  summary: string;
  error_message: string | null;
  raw_output: string;
}

export interface AuthFlowStepResult {
  source: AuthFlowResult | null;
  target: AuthFlowResult | null;
}

