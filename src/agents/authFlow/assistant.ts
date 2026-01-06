// src/agents/authFlow/assistant.ts

import type { AgentConfig } from "./types";

export const getAuthFlowConfig = (): AgentConfig => {
  const instructions = `Du bist der Celion Auth Flow Agent. Deine Aufgabe ist es, API-Credentials zu validieren.

ABLAUF:
1. Lies zuerst das Schema für das System mit dem read_scheme Tool
2. Rufe construct_auth_header auf mit den Credentials und Schema-Infos
3. Führe http_request aus mit den konstruierten Headers
4. Interpretiere das Ergebnis

WICHTIG: Konstruiere NIEMALS die Authorization-Header selbst!
Nutze IMMER construct_auth_header - nur dieses Tool kann Base64 korrekt kodieren.

construct_auth_header PARAMETER:
- auth_type: aus schema.auth.type (z.B. "basic", "bearer", "bearer_token")
- email: aus den übergebenen Credentials (wenn schema.auth.requiresEmail = true)
- api_token: aus den übergebenen Credentials
- additional_headers: aus schema.headers (z.B. { "Accept": "application/json" })

BASE-URL LOGIK:
- Wenn apiBaseUrl im Schema definiert ist, verwende diese
- Sonst verwende die übergebene baseUrl

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
        name: "construct_auth_header",
        description: "Konstruiert die Auth-Header basierend auf Schema und Credentials. Führt Base64-Encoding für Basic Auth durch. MUSS für alle Header-Konstruktion verwendet werden!",
        parameters: {
          type: "object",
          properties: {
            auth_type: {
              type: "string",
              enum: ["basic", "bearer", "bearer_token", "api_key_header", "api_key_query", "api_key_token_query"],
              description: "Der Auth-Typ aus dem Schema (auth.type)",
            },
            email: {
              type: "string",
              description: "Email für Basic Auth (nur wenn auth.requiresEmail = true)",
            },
            api_token: {
              type: "string",
              description: "API Token für Basic/Bearer Auth",
            },
            additional_headers: {
              type: "object",
              description: "Zusätzliche Headers aus dem Schema (headers-Objekt, z.B. Accept, Content-Type)",
            },
          },
          required: ["auth_type"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "http_request",
        description: "Führt einen HTTP-Request aus, um API-Credentials zu validieren. Nutzt den Backend-Proxy um CORS zu umgehen. WICHTIG: Verwende die Headers aus construct_auth_header!",
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
              description: "HTTP-Header aus construct_auth_header (Authorization, Content-Type, etc.)",
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

  return {
    instructions,
    tools,
  };
};
