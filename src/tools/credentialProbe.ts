export interface CredentialProbeRequest {
  url: string;                // vollständige API-URL
  method: string;             // GET, POST etc.
  headers: Record<string, string>;
  body?: any | null;
}

export interface CredentialProbeApiResponse {
  status: number | null;
  ok: boolean;
  body: any | null;
  raw_response?: string | null;
  error: string | null;
  evidence?: {
    request_url?: string;
    method?: string;
    used_headers?: string[];
    timestamp?: string;
  };
}

export interface CredentialProbeResult {
  status: number | null;      // HTTP Status oder null bei Netzwerkfehler
  body: any | null;           // API Response (gekürzt)
  raw_response: string | null; // Ungefilterte Antwort des Zielsystems
  error: string | null;       // Netzwerk- oder Parserfehler
  evidence: {
    request_url: string;
    method: string;
    used_headers: string[];
    timestamp: string;
  };
}

export async function credentialProbe(
  req: CredentialProbeRequest
): Promise<CredentialProbeResult> {

  const usedHeaders = Object.keys(req.headers || {});

  try {
    const response = await fetch("/api/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body ?? null,
      }),
    });

    const raw = await response.text();
    let probeResponse: CredentialProbeApiResponse | null = null;
    let parseError: string | null = null;

    if (raw) {
      try {
        probeResponse = JSON.parse(raw) as CredentialProbeApiResponse;
      } catch (err) {
        parseError = `Invalid probe response format (status ${response.status}): ${raw}`;
      }
    }

    const timestamp =
      probeResponse?.evidence?.timestamp || new Date().toISOString();

    const status = probeResponse?.status ?? response.status ?? null;
    const body = probeResponse?.body ?? null;
    const rawResponse = probeResponse?.raw_response ?? null;

    let error = probeResponse?.error ?? null;

    if (!probeResponse) {
      if (!response.ok) {
        const statusText = response.statusText
          ? ` ${response.statusText}`
          : "";
        error = `Probe endpoint returned status ${response.status}${statusText}`;
      } else if (parseError) {
        error = parseError;
      } else {
        error = `Probe endpoint returned empty response (status ${response.status})`;
      }
    } else if (parseError && !error) {
      error = parseError;
    }

    return {
      status,
      body,
      raw_response: rawResponse,
      error,
      evidence: {
        request_url: probeResponse?.evidence?.request_url || req.url,
        method: probeResponse?.evidence?.method || req.method,
        used_headers: probeResponse?.evidence?.used_headers || usedHeaders,
        timestamp,
      },
    };

  } catch (err: any) {
    const timestamp = new Date().toISOString();
    return {
      status: null,
      body: null,
      raw_response: null,
      error: err?.message || "Unknown network error",
      evidence: {
        request_url: req.url,
        method: req.method,
        used_headers: usedHeaders,
        timestamp,
      }
    };
  }
}
