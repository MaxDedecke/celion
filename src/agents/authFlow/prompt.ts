// src/agents/authFlow/prompt.ts

export const buildAuthFlowPrompt = (system: string, baseUrl: string) => {
  return [
    `System: ${system}. Base-URL: ${baseUrl}.`,
    "Liefere nur Endpunkt und HTTP Methode für Authentifizierung.",
    "Antworte ausschließlich als JSON mit den Feldern system, base_url, recommended_probe { method, url, requires_auth, api_format (rest_json|graphql|soap_xml|xml), auth_scheme (basic|bearer|none)?, graphql { query, operation_name?, variables? } }, reasoning.",
    "Keine Header, keine Beispiel-Tokens, kein Base64, keine Platzhalter.",
    "Falls GraphQL erforderlich ist, gib den passenden GraphQL-Query an.",
    "Gib immer die vollständige API-URL zurück (z.B. https://api.monday.com/v2).",
  ].join(" ");
};
