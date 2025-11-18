export interface SchemaProbeRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: any | null;
}

export interface SchemaProbeResponse {
  status: number | null;
  ok: boolean;
  body: any | null;
  raw_response: string | null;
  error: string | null;
}

export async function schemaProbe(request: SchemaProbeRequest): Promise<SchemaProbeResponse> {
  try {
    const response = await fetch("/api/schema-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: request.method,
        url: request.url,
        headers: request.headers ?? {},
        body: request.body ?? null,
      }),
    });

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as SchemaProbeResponse) : null;

    if (!parsed) {
      return {
        status: response.status ?? null,
        ok: response.ok,
        body: null,
        raw_response: text || null,
        error: response.ok ? null : `Schema probe failed with status ${response.status}`,
      };
    }

    return parsed;
  } catch (error) {
    return {
      status: null,
      ok: false,
      body: null,
      raw_response: null,
      error: error instanceof Error ? error.message : "Unbekannter Fehler bei der Schema-Probe",
    };
  }
}
