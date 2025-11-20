// src/agents/authFlow/types.ts

export type AuthHeaders = Record<string, string>;

export type AuthProbeConfig = {
  method: string;
  url: string;
  headers: AuthHeaders;
  request_format?: "rest_json" | "graphql" | "form" | "xml" | null;
  graphql?: {
    query: string;
    operation_name?: string | null;
    variables?: Record<string, any> | null;
  } | null;
};

export type AuthFlowResult = {
  system: string | null;
  base_url: string | null;

  // Ob die Credentials für dieses System erfolgreich validiert wurden
  authenticated: boolean;

  // z.B. "bearer", "basic", "api_token_in_header"
  auth_method: string | null;

  // alle vom Agent berechneten Header (inkl. Notion-Version etc.)
  auth_headers: AuthHeaders;

  // für UI/Logs
  explanation: string;

  // Probe-Config, die direkt an /api/probe gesendet werden kann
  recommended_probe: AuthProbeConfig;

  // Debug / Nachvollziehbarkeit
  raw_output: any;
};
