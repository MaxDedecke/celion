// src/agents/authFlow/assistant.ts

import type { OpenAiAssistant } from "../openai/types";

export const createAuthFlowAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OpenAiAssistant> => {
  const instructions = `Du bist der Celion Auth Flow Agent. Deine Aufgabe ist es, API-Credentials zu validieren.

ABLAUF:
1. Lies zuerst das Schema für das System mit dem read_scheme Tool
2. Konstruiere die korrekten Auth-Header basierend auf dem Schema und den Credentials
3. Führe einen HTTP-Request zum Probe-Endpoint aus
4. Interpretiere das Ergebnis

HEADER-KONSTRUKTION:
- Bei type "basic": Authorization: Basic base64(email:apiToken)
- Bei type "bearer" oder "bearer_token": Authorization: Bearer <token>
- Bei type "api_key_query": Credentials als Query-Parameter (nicht im Header)
- Beachte zusätzliche Headers aus dem Schema (z.B. Notion-Version, Content-Type)

BASE-URL LOGIK:
- Wenn apiBaseUrl im Schema definiert ist, verwende diese
- Sonst extrahiere die Domain aus der übergebenen baseUrl

ANTWORT-FORMAT (NUR JSON, kein anderer Text):
{
  "valid": boolean,
  "explanation": "Lesbare Erklärung für den Chat (1-2 Sätze)",
  "errorHint": "Bei Fehler: konkreter Hinweis was falsch sein könnte (null bei Erfolg)",
  "authType": "basic|bearer|api_key_query|...",
  "apiType": "REST|GRAPHQL",
  "probe": {
    "method": "GET|POST",
    "endpoint": "/...",
    "status": 200
  },
  "normalizedHeaders": { "Authorization": "...", ... },
  "schemeUsed": "jiracloud"
}

FEHLER-HINWEISE (errorHint):
- Bei 401: "Die Credentials scheinen ungültig zu sein. Prüfe ob der API-Token korrekt kopiert wurde."
- Bei 403: "Der Zugriff wurde verweigert. Möglicherweise fehlen dem Token die nötigen Berechtigungen."
- Bei 404: "Der Probe-Endpoint wurde nicht gefunden. Prüfe ob die Base-URL korrekt ist."
- Bei Netzwerkfehler: "Verbindung fehlgeschlagen. Prüfe ob die URL erreichbar ist."

Antworte NUR mit dem JSON-Objekt, ohne Markdown-Codeblöcke oder anderen Text.`;

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "read_scheme",
        description: "Liest eine Schema-Datei aus /schemes/{system}.json. Die Schema-Datei enthält Auth-Konfiguration, Probe-Endpoints und Header-Templates.",
        parameters: {
          type: "object",
          properties: {
            system: {
              type: "string",
              description: "Der normalisierte System-Name (z.B. 'jiracloud', 'asana', 'mondaycom', 'notion'). Kleinbuchstaben, keine Sonderzeichen.",
            },
          },
          required: ["system"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "http_request",
        description: "Führt einen HTTP-Request aus, um API-Credentials zu validieren. Nutzt den Backend-Proxy um CORS zu umgehen.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Die vollständige URL für den Request (Base-URL + Probe-Endpoint)",
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
              description: "Die HTTP-Methode",
            },
            headers: {
              type: "object",
              description: "HTTP-Header als Key-Value-Paare (Authorization, Content-Type, etc.)",
            },
            body: {
              type: "string",
              description: "Request Body als String (optional, für POST/PUT). Bei GraphQL der JSON-String mit query.",
            },
          },
          required: ["url", "method", "headers"],
        },
      },
    },
  ];

  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion Auth Flow Agent",
      description: "Validiert API-Credentials für Celion Migrationen mittels Schema-basierter Authentifizierung.",
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
