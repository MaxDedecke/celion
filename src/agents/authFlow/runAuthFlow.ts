// src/agents/authFlow/runAuthFlow.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createAuthFlowAssistant } from "./assistant";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { parseAuthFlowResponse } from "./parser";
import { readSchemeFile } from "@/tools/readSchemeFile";
import { httpRequestTool } from "../openai/httpTool";
import type { HttpRequestParams } from "@/types/agents";
import type { OpenAiRun } from "../openai/types";
import type { AuthFlowResult, AuthSchemeDefinition } from "./types";

export type RunAuthFlowParams = {
  system: string;
  baseUrl: string;
  apiToken?: string;
  email?: string;
  password?: string;
};

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
2. Konstruiere die Auth-Header basierend auf Schema und Credentials
3. Führe den Probe-Request aus
4. Gib das Ergebnis als JSON zurück`;
};

const processAuthFlowRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
): Promise<OpenAiRun> => {
  let attempts = 0;

  while (attempts < 120) {
    const res = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, { headers });
    const payload = (await res.json()) as OpenAiRun;

    if (payload.status === "requires_action" && payload.required_action?.submit_tool_outputs) {
      const toolOutputs: Array<{ tool_call_id: string; output: string }> = [];

      for (const call of payload.required_action.submit_tool_outputs.tool_calls) {
        if (call.type !== "function") continue;

        // read_scheme Tool
        if (call.function?.name === "read_scheme") {
          let args: { system: string } = { system: "" };
          try {
            args = JSON.parse(call.function?.arguments ?? "{}");
          } catch {
            // ignore parsing error
          }

          try {
            const schemePath = `/schemes/${args.system}.json`;
            const scheme = await readSchemeFile<AuthSchemeDefinition>({ path: schemePath });
            toolOutputs.push({ tool_call_id: call.id, output: JSON.stringify(scheme) });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Schema nicht gefunden";
            toolOutputs.push({ 
              tool_call_id: call.id, 
              output: JSON.stringify({ error: errorMessage }) 
            });
          }
        }

        // http_request Tool
        if (call.function?.name === "http_request") {
          let args: HttpRequestParams & { body?: string } = { url: "", method: "GET", headers: {} };
          try {
            args = JSON.parse(call.function?.arguments ?? "{}");
          } catch {
            // ignore parsing error
          }

          // Parse body string to object if provided
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
          toolOutputs.push({ tool_call_id: call.id, output: JSON.stringify(output) });
        }
      }

      if (toolOutputs.length > 0) {
        await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ tool_outputs: toolOutputs }),
        });
      }
    } else if (payload.status === "completed") {
      return payload;
    } else if (["failed", "cancelled", "expired"].includes(payload.status)) {
      throw new Error(payload.last_error?.message || `Auth Flow Run failed: ${payload.status}`);
    }

    attempts++;
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error("Auth Flow Run timeout");
};

export const runAuthFlow = async (params: RunAuthFlowParams): Promise<AuthFlowResult> => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const assistant = await createAuthFlowAssistant(baseUrl, headers, "gpt-4.1-mini");
  const thread = await createThread(baseUrl, headers);

  await postUserMessage(
    baseUrl,
    headers,
    thread,
    buildAuthFlowPrompt(params),
  );

  const run = await createRun(baseUrl, headers, thread, assistant.id);
  await processAuthFlowRun(baseUrl, headers, thread, run.id);

  const msg = await fetchLatestAssistantMessage(baseUrl, headers, thread);
  const parsed = parseAuthFlowResponse(extractMessageText(msg));

  // Ergänze Felder für Abwärtskompatibilität
  return {
    ...parsed,
    system: parsed.system ?? params.system,
    base_url: parsed.base_url ?? params.baseUrl,
    authenticated: parsed.valid,
    auth_method: parsed.authType,
    auth_headers: parsed.normalizedHeaders,
    raw_output: msg,
  };
};
