// src/agents/systemDetection/runSystemDetection.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { buildSystemDetectionPrompt } from "./prompt";
import { createConversation } from "../openai/conversation";
import { createResponse } from "../openai/run";
import { extractMessageText, extractJson } from "../openai/message";
import { parseSystemDetectionResponse, SystemDetectionResult } from "./parser";
import { curlHeadProbeTool } from "../openai/curlHeadTool";
import { httpRequestTool } from "../openai/httpTool";
import type {
  CurlHeadProbeParams,
  HttpRequestParams,
  CurlHeadProbeResponse,
} from "../../types/agents";
import type {
  OpenAiResponse,
  OpenAiResponseToolCall,
  OpenAiResponseMessage,
} from "../openai/types";

// --- Assistant Definition (from assistant.ts) ---

const getInstructions = (expectedSystem?: string) => {
  const expectedSystemNote = expectedSystem
    ? ` WICHTIG: Der Benutzer erwartet, dass es sich bei der URL um ein "${expectedSystem}"-System handelt. Deine Hauptaufgabe ist es zu validieren, ob die URL tatsächlich zu diesem erwarteten System passt. Setze "systemMatchesUrl" nur dann auf true, wenn der erkannte Subtyp mit "${expectedSystem}" übereinstimmt.`
    : "";

  return [
    "Du bist der Celion System Detection Agent.",
    "WICHTIG: Der Nutzer gibt eine beliebige URL zu seinem System an (z.B. die URL seines Jira Workspaces wie 'https://company.atlassian.net/jira/...').",
    "Deine Aufgabe ist es, von dieser URL das dahinterliegende System zu identifizieren UND die korrekte API Base-URL abzuleiten.",
    "Schritt 1 – System Detection (mit Curl-HEAD Probe): Nutze zwingend curl_head_probe(url) als ersten Schritt, um Header, Redirects und Server-Signaturen zu erkennen.",
    "curl_head_probe und http_probe rufen das Celion FastAPI Backend als Proxy auf, verwende sie für alle Requests.",
    "Analysiere Header wie www-authenticate, x-monday-region, x-asana-content-type, x-powered-by AJS sowie Hinweise auf Proxies (AtlassianProxy, Envoy, Cloudflare, nginx, Spring Boot).",
    "Führe nur sinnvolle http_probe-Aufrufe auf typischen API-Pfaden aus (/rest/api/3/serverInfo, /graphql, /v2, /soap, /wsdl) und nutze die Ergebnisse zur Klassifikation (REST, GraphQL, SOAP, gRPC).",
    "Klassifiziere Subtypen (z. B. Atlassian-Jira-Cloud) und leite eine empfohlene Base-URL aus Redirects und Pfaden ab.",
    "Antworte ausschließlich im JSON-Format mit den Feldern systemMatchesUrl, apiTypeDetected, apiSubtype, recommendedBaseUrl, confidenceScore, detectionEvidence und rawOutput.",
    "Setze systemMatchesUrl nur auf true, wenn die erkannte API eindeutig zum erwarteten System passt; confidenceScore muss zwischen 0 und 1 liegen.",
    "detectionEvidence darf strukturierte Hinweise (headers, status_codes, redirects, notes) enthalten und rawOutput soll eine kompakte Zusammenfassung der Schritte liefern.",
    expectedSystemNote,
  ].join(" ");
};

const tools = [
  {
    type: "function" as const,
    function: {
      name: "curl_head_probe",
      description:
        "Führt einen curl -I HEAD Request über das Backend aus und liefert Header, Status und Redirects.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Vollständige URL, die per HEAD geprüft werden soll" },
          headers: {
            type: "object",
            description: "HTTP Header als Key-Value Map",
            additionalProperties: { type: "string" },
          },
          follow_redirects: {
            type: "boolean",
            description: "Ob Redirects automatisch gefolgt werden sollen (Standard: true)",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "http_probe",
      description: "Führt GET/POST/HEAD Requests über das Backend aus, um typische API-Pfade zu testen.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Vollständige URL des Requests" },
          method: { type: "string", description: "HTTP Methode" },
          headers: {
            type: "object",
            description: "HTTP Header als Key-Value Map",
            additionalProperties: { type: "string" },
          },
          body: { description: "Request Body (JSON oder Text)" },
        },
        required: ["url", "method"],
      },
    },
  },
];

// --- Tool Execution ---

const executeToolCall = async (call: OpenAiResponseToolCall): Promise<{ tool_call_id: string; output: string }> => {
  const { id, function: fn } = call;

  if (fn.name === "curl_head_probe") {
    let args: CurlHeadProbeParams = { url: "" } as CurlHeadProbeParams;
    try {
      args = JSON.parse(fn.arguments ?? "{}") as CurlHeadProbeParams;
    } catch { /* ignore */ }
    const output = (await curlHeadProbeTool(args)) as CurlHeadProbeResponse;
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  if (fn.name === "http_probe") {
    let args: HttpRequestParams = { url: "", method: "GET" };
    try {
      args = JSON.parse(fn.arguments ?? "{}") as HttpRequestParams;
    } catch { /* ignore */ }
    const output = await httpRequestTool(args);
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  return { tool_call_id: id, output: JSON.stringify({ error: `Unknown tool: ${fn.name}` }) };
};

// --- Main Logic ---

export const runSystemDetection = async (
  url: string,
  expectedSystem?: string,
): Promise<SystemDetectionResult> => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const conversationId = await createConversation(baseUrl, headers);

  const instructions = getInstructions(expectedSystem);
  const prompt = buildSystemDetectionPrompt(url, expectedSystem);

  const systemMessage = { role: "system", content: instructions };
  const userMessage = { role: "user", content: prompt };
  let inputMessages: any[] = [systemMessage, userMessage];
  let response: OpenAiResponse | undefined;

  for (let i = 0; i < 5; i++) {
    response = await createResponse(baseUrl, headers, conversationId, {
      model: "gpt-4.1-mini",
      input: inputMessages,
      tools,
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
      return parseSystemDetectionResponse(jsonText);
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
      throw new Error("System Detection returned no message or tool calls.");
    }
  }

  throw new Error("System Detection did not complete within 5 iterations.");
};