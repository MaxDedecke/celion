// src/agents/authFlow/runAuthFlow.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createConversation } from "../openai/conversation";
import { createResponse } from "../openai/run";
import { extractMessageText, extractJson } from "../openai/message";
import { parseAuthFlowResponse } from "./parser";
import { readSchemeFile } from "../../tools/readSchemeFile";
import { httpRequestTool } from "../openai/httpTool";
import type { HttpRequestParams } from "../../types/agents";
import type {
  OpenAiOutputItem,
  OpenAiResponse,
  OpenAiResponseMessage,
  OpenAiResponseToolCall,
} from "../openai/types";
import type { AuthFlowResult, AuthSchemeDefinition } from "./types";

export type RunAuthFlowParams = {
  system: string;
  baseUrl: string;
  apiToken?: string;
  email?: string;
  password?: string;
};

// --- Assistant Definition (moved from assistant.ts) ---

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
    "endpoint": "/…",
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
      description:
        "Liest eine Schema-Datei aus /schemes/{system}.json. Die Schema-Datei enthält Auth-Konfiguration, Probe-Endpoints und Header-Templates.",
      parameters: {
        type: "object",
        properties: {
          system: {
            type: "string",
            description:
              "Der normalisierte System-Name (z.B. 'jiracloud', 'asana', 'mondaycom', 'notion'). Kleinbuchstaben, keine Sonderzeichen.",
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
      description:
        "Konstruiert die Auth-Header basierend auf Schema und Credentials. Führt Base64-Encoding für Basic Auth durch. MUSS für alle Header-Konstruktion verwendet werden!",
      parameters: {
        type: "object",
        properties: {
          auth_type: {
            type: "string",
            enum: [
              "basic",
              "bearer",
              "bearer_token",
              "api_key_header",
              "api_key_query",
              "api_key_token_query",
            ],
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
            description:
              "Zusätzliche Headers aus dem Schema (headers-Objekt, z.B. Accept, Content-Type)",
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
      description:
        "Führt einen HTTP-Request aus, um API-Credentials zu validieren. Nutzt den Backend-Proxy um CORS zu umgehen. WICHTIG: Verwende die Headers aus construct_auth_header!",
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
            description:
              "Request Body als String (optional, für POST/PUT). Bei GraphQL der JSON-String mit query.",
          },
        },
        required: ["url", "method", "headers"],
      },
    },
  },
];

// --- Tool Execution Logic ---

const executeToolCall = async (call: OpenAiResponseToolCall): Promise<{ tool_call_id: string; output: string }> => {
  const { id, function: fn } = call;

  if (fn.name === "read_scheme") {
    let args: { system: string } = { system: "" };
    try {
      args = JSON.parse(fn.arguments ?? "{}");
    } catch {
      /* ignore parsing error */
    }
    try {
      const schemePath = `/schemes/${args.system}.json`;
      const scheme = await readSchemeFile<AuthSchemeDefinition>({ path: schemePath });
      return { tool_call_id: id, output: JSON.stringify(scheme) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Schema nicht gefunden";
      return {
        tool_call_id: id,
        output: JSON.stringify({ error: errorMessage }),
      };
    }
  }

  if (fn.name === "construct_auth_header") {
    let args: {
      auth_type: string;
      email?: string;
      api_token?: string;
      additional_headers?: Record<string, string>;
    } = { auth_type: "" };
    try {
      args = JSON.parse(fn.arguments ?? "{}");
    } catch {
      /* ignore parsing error */
    }

    let constructedHeaders: Record<string, string> = {};
    if (args.auth_type === "basic" && args.email && args.api_token) {
      const credentials = `${args.email}:${args.api_token}`;
      const base64Encoded = btoa(credentials);
      constructedHeaders["Authorization"] = `Basic ${base64Encoded}`;
    } else if (["bearer", "bearer_token"].includes(args.auth_type) && args.api_token) {
      constructedHeaders["Authorization"] = `Bearer ${args.api_token}`;
    } else if (args.auth_type === "api_key_header" && args.api_token) {
      constructedHeaders["X-Api-Key"] = args.api_token;
    }

    if (args.additional_headers) {
      for (const [key, value] of Object.entries(args.additional_headers)) {
        if (key.toLowerCase() === "contenttype") constructedHeaders["Content-Type"] = value;
        else if (key.toLowerCase() === "accept") constructedHeaders["Accept"] = value;
        else constructedHeaders[key] = value;
      }
    }
    return { tool_call_id: id, output: JSON.stringify(constructedHeaders) };
  }

  if (fn.name === "http_request") {
    let args: HttpRequestParams & { body?: string } = { url: "", method: "GET", headers: {} };
    try {
      args = JSON.parse(fn.arguments ?? "{}");
    } catch {
      /* ignore parsing error */
    }

    let bodyPayload: unknown = null;
    if (args.body && typeof args.body === "string") {
      try {
        bodyPayload = JSON.parse(args.body);
      } catch {
        bodyPayload = args.body;
      }
    }

    const output = await httpRequestTool({
      url: args.url,
      method: args.method,
      headers: args.headers || {},
      body: bodyPayload,
    });
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  return { tool_call_id: id, output: JSON.stringify({ error: `Unknown tool: ${fn.name}` }) };
};

// --- Prompt & Main Logic ---

const normalizeSystemName = (systemName: string): string =>
  systemName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

const buildAuthFlowPrompt = (params: RunAuthFlowParams): string => {
  const normalizedSystem = normalizeSystemName(params.system);

  const credentialParts: string[] = [];
  if (params.email) credentialParts.push(`- Email: ${params.email}`);
  if (params.apiToken) credentialParts.push(`- API Token: ${params.apiToken}`);
  if (params.password) credentialParts.push(`- Password: ${params.password}`);

  return `Validiere die Authentifizierung für folgendes System:

System: ${params.system}
Normalisierter System-Name für Schema: ${normalizedSystem}
Base URL: ${params.baseUrl}

Credentials:
${credentialParts.join("\n")}

Schritte:
1. Lies das Schema mit read_scheme für "${normalizedSystem}"
2. Nutze construct_auth_header mit auth_type aus dem Schema, email und api_token aus den Credentials, und additional_headers aus schema.headers
3. Führe http_request aus mit den konstruierten Headers zum Probe-Endpoint
4. Gib das Ergebnis als JSON zurück

WICHTIG: Verwende IMMER construct_auth_header für die Header-Konstruktion!`;
};

export const runAuthFlow = async (params: RunAuthFlowParams): Promise<AuthFlowResult> => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const conversationId = await createConversation(baseUrl, headers);

  const prompt = buildAuthFlowPrompt(params);
  const systemMessage = { role: "system", content: instructions };
  const userMessage = { role: "user", content: prompt };

  let inputMessages: any[] = [systemMessage, userMessage];
  let response: OpenAiResponse | undefined;

  for (let i = 0; i < 5; i++) {
    response = await createResponse(baseUrl, headers, conversationId, {
      model: "gpt-4.1-mini",
      input: inputMessages,
      tools: tools,
    });

    const toolCalls = response.output.filter(
      (o): o is OpenAiResponseToolCall => o.type === "tool_call",
    );
    const messages = response.output.filter(
      (o): o is OpenAiResponseMessage => o.type === "message",
    );

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const rawText = extractMessageText({ ...lastMessage, id: "", role: "assistant" });
      const jsonText = extractJson(rawText);
      const parsed = parseAuthFlowResponse(jsonText);

      return {
        ...parsed,
        system: parsed.system ?? params.system,
        base_url: parsed.base_url ?? params.baseUrl,
        authenticated: parsed.valid,
        auth_method: parsed.authType,
        auth_headers: parsed.normalizedHeaders,
        raw_output: rawText,
      };
    }

    if (toolCalls.length > 0) {
      const assistantResponse = {
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      };
      const toolOutputs = await Promise.all(toolCalls.map(executeToolCall));
      const toolResponseMessages = toolOutputs.map(t => ({
        role: "tool",
        tool_call_id: t.tool_call_id,
        content: t.output,
      }));

      inputMessages = [...inputMessages, assistantResponse, ...toolResponseMessages];
    } else {
      throw new Error("Auth Flow returned no message or tool calls.");
    }
  }

  throw new Error("Auth Flow did not complete within 5 iterations.");
};