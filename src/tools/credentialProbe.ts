// Tool for credential probing via FastAPI backend
export interface CredentialProbeParams {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  request_format?: string;
  graphql?: {
    query?: string;
    operation_name?: string;
    variables?: Record<string, unknown>;
  };
}

export interface ProbeEvidence {
  request_url: string;
  method: string;
  used_headers: string[];
  timestamp: string;
}

export interface CredentialProbeResponse {
  status: number | null;
  ok: boolean;
  body: unknown;
  raw_response: string | null;
  error: string | null;
  evidence: ProbeEvidence;
}

const API_PROBE_PATH = "/api/probe";

export const credentialProbe = async (
  params: CredentialProbeParams
): Promise<CredentialProbeResponse> => {
  const trimmedUrl = params.url?.trim();

  if (!trimmedUrl) {
    return {
      status: null,
      ok: false,
      body: null,
      raw_response: null,
      error: "Es wurde keine gültige URL für credentialProbe angegeben.",
      evidence: {
        request_url: "",
        method: params.method || "GET",
        used_headers: [],
        timestamp: new Date().toISOString(),
      },
    };
  }

  try {
    const response = await fetch(API_PROBE_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: trimmedUrl,
        method: params.method || "GET",
        headers: params.headers || {},
        body: params.body,
        request_format: params.request_format,
        graphql: params.graphql,
      }),
    });

    if (!response.ok) {
      const message = (await response.text()) || response.statusText;
      return {
        status: response.status,
        ok: false,
        body: null,
        raw_response: null,
        error: `Backend probe Fehler: ${message}`,
        evidence: {
          request_url: trimmedUrl,
          method: params.method || "GET",
          used_headers: Object.keys(params.headers || {}),
          timestamp: new Date().toISOString(),
        },
      };
    }

    const payload = (await response.json()) as CredentialProbeResponse;
    return payload;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unbekannter Fehler bei credentialProbe.";
    return {
      status: null,
      ok: false,
      body: null,
      raw_response: null,
      error: message,
      evidence: {
        request_url: trimmedUrl,
        method: params.method || "GET",
        used_headers: Object.keys(params.headers || {}),
        timestamp: new Date().toISOString(),
      },
    };
  }
};
