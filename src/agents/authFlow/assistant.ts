// src/agents/authFlow/assistant.ts

import type { OpenAiAssistant } from "../openai/types";
import { httpRequestTool } from "../openai/httpTool";

export const createAuthFlowAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OpenAiAssistant> => {

  const instructions = [
    "Du bist der Celion Auth Flow Agent.",
    "Deine Aufgabe ist es, API-Credentials zu validieren, indem du einen echten Request an die API machst.",
    "1. Analysiere das Zielsystem und bestimme die korrekte Authentifizierungsmethode.",
    "2. Generiere alle notwendigen HTTP-Header (Authorization, Content-Type, spezielle Header wie Notion-Version, etc.).",
    "3. Wähle einen geeigneten Endpunkt (z.B. /me, /user, /whoami) zur Validierung.",
    "4. Führe den Request mit dem httpRequest-Tool aus.",
    "5. Analysiere die Antwort: Bei Status 200-299 ist die Authentifizierung erfolgreich, bei 401/403 fehlgeschlagen.",
    "Antworte ausschließlich als JSON mit den Feldern: system, base_url, authenticated (boolean basierend auf Response), auth_method, auth_headers, recommended_probe, explanation, raw_output.",
    "Für Jira Cloud: Basic Auth mit base64(email:api_token).",
    "Für Monday.com: Bearer Token im Authorization-Header, GraphQL an https://api.monday.com/v2.",
    "Für Notion: Bearer Token, Notion-Version: 2022-06-28 Header erforderlich.",
  ].join(" ");

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "httpClient",
        description:
          "Führt einen HTTP-Request aus, um API-Credentials zu validieren. Nutzt den Backend-Proxy (/api/http-client) um CORS zu umgehen.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Die vollständige URL für den Request",
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
              description: "Die HTTP-Methode",
            },
            headers: {
              type: "object",
              description:
                "HTTP-Header als Key-Value-Paare (z.B. Authorization, Content-Type, etc.)",
            },
            body: {
              type: "object",
              description: "Request Body (optional, für POST/PUT)",
            },
          },
          required: ["url", "method"],
        },
      },
    },
  ];

  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion Auth Flow",
      description: "Validiert API-Credentials für Celion Migrationen.",
      instructions,
      tools,
    }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI Auth Flow Agent konnte nicht erstellt werden: ${msg}`);
  }

  const payload = await response.json();
  if (!payload.id) throw new Error("OpenAI Auth Flow Agent-Antwort enthielt keine ID.");

  return { id: payload.id };
};
