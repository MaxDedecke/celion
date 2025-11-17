import fetch, { Headers } from "node-fetch";

export interface CredentialProbeRequest {
  url: string;                // vollständige API-URL
  method: string;             // GET, POST etc.
  headers: Record<string, string>;
  body?: any | null;
}

export interface CredentialProbeResult {
  status: number | null;      // HTTP Status oder null bei Netzwerkfehler
  body: any | null;           // API Response (gekürzt)
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
  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? JSON.stringify(req.body) : undefined
    });

    const text = await response.text();
    let parsed = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 500); // Response-Auszug
    }

    return {
      status: response.status,
      body: parsed,
      error: null,
      evidence: {
        request_url: req.url,
        method: req.method,
        used_headers,
        timestamp
      }
    };

  } catch (err: any) {
    return {
      status: null,
      body: null,
      error: err?.message || "Unknown network error",
      evidence: {
        request_url: req.url,
        method: req.method,
        used_headers,
        timestamp
      }
    };
  }
}
