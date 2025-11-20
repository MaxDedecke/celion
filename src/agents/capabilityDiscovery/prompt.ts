// src/agents/capabilityDiscovery/prompt.ts

export const buildCapabilityDiscoveryPrompt = (
  system: string,
  baseUrl: string,
  credentials: { apiToken?: string; email?: string; password?: string }
) => {
  return [
    "Finde API-Spec → analysiere → leite Probe-Strategie ab → führe httpClient-Calls aus → liefere Capability-Analyse.",
    `System: ${system || "Unbekannt"}.`,
    `Base URL: ${baseUrl}.`,
    credentials.apiToken ? `API Token: ${credentials.apiToken}.` : "",
    credentials.email ? `Email: ${credentials.email}.` : "",
    credentials.password ? `Password: ${credentials.password}.` : "",
    "Vorgehen:",
    "- Finde offizielle API-Spezifikation (OpenAPI/Swagger) über klassische Pfade (/openapi.json, /swagger.json, /api-docs, /v1/openapi.json).",
    "- Falls REST nicht verfügbar: versuche GraphQL-Introspection (/graphql).",
    "- Probiere alternative Spezifikationspfade abhängig vom Systemtyp (z. B. /rest/api/latest/spec).",
    "- Analysiere die gefundene Spec und leite Entities, Felder/Schemas, Endpunkte, Pagination, Auth-Modell und Limits ab.",
    "- Plane Probe-Requests (minimale GETs, Pagination, Feld-Validierung, Counts) und führe ALLE über httpClient aus.",
    "- Keine statischen oder vordefinierten Endpunkte verwenden; alle Erkenntnisse müssen aus Spec oder Probes stammen.",
    "- Nutze bereitgestellte Credentials nur falls erforderlich (Bearer/Basic).",
    "Output ausschließlich als JSON im Format: { api_spec_found, spec_url, entities, endpoints, schemas, authentication, pagination, probe_results, limitations, summary }",
  ]
    .filter(Boolean)
    .join("\n");
};
