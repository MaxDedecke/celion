// src/agents/authFlow/runAuthFlow.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { httpRequestTool } from "../openai/httpTool";
import type { OpenAiRun } from "../openai/types";
import type { HttpRequestParams } from "@/types/agents";

import { createAuthFlowAssistant } from "./assistant";
import { buildAuthFlowPrompt, type BuildAuthFlowPromptParams } from "./prompt";
import { parseAuthFlowResponse } from "./parser";
import type { AuthFlowResult } from "./types";
import { supabase } from "@/integrations/supabase/client";

export type RunAuthFlowParams = {
  system: string;              // "Jira Cloud", "Asana", "Azure DevOps", Monday
  baseUrl: string;             // Pflicht
  apiToken?: string;           // optional
  email?: string;              // optional
  password?: string;           // optional
  authType?: string;
  /**
   * NEW: Agent soll Header automatisch erzeugen können.
   * Beispiel:
   * { "Authorization": "Basic abc123", "Accept": "application/json" }
   */
  preferredAuthType?: "basic" | "bearer" | "apiKey" | "oauth2" | "auto";

  /**
   * NEW: optionaler API Key Name, falls Systeme sowas brauchen
   * Beispiele:
   *   - X-API-Key
   *   - Authorization
   *   - Private-Token
   */
  apiKeyHeaderName?: string;

  /**
   * NEW: Systeme nutzen manchmal Query-Keys statt Header
   */
  apiKeyQueryName?: string;
};

/**
 * Ersetzt Platzhalter in einem String durch echte Credentials.
 * Beispiel: "Basic base64(<email>:<apiToken>)" -> "Basic base64(user@example.com:abc123)"
 */
const replacePlaceholders = (
  value: string,
  credentials: { email?: string; apiToken?: string; password?: string; clientId?: string; clientSecret?: string }
): string => {
  let result = value;
  if (credentials.email) result = result.replace(/<email>/g, credentials.email);
  if (credentials.apiToken) result = result.replace(/<apiToken>/g, credentials.apiToken);
  if (credentials.password) result = result.replace(/<password>/g, credentials.password);
  if (credentials.clientId) result = result.replace(/<clientId>/g, credentials.clientId);
  if (credentials.clientSecret) result = result.replace(/<clientSecret>/g, credentials.clientSecret);
  
  // Jetzt Base64-Encoding durchführen, falls nötig
  // Beispiel: "Basic base64(user@example.com:abc123)" -> "Basic dXNlckBleGFtcGxlLmNvbTphYmMxMjM="
  const base64Match = result.match(/base64\(([^)]+)\)/);
  if (base64Match) {
    const toEncode = base64Match[1];
    const encoded = btoa(toEncode);
    result = result.replace(`base64(${toEncode})`, encoded);
  }
  
  return result;
};

const processAuthRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
  credentials: { email?: string; apiToken?: string; password?: string; clientId?: string; clientSecret?: string }
): Promise<OpenAiRun> => {
  let attempts = 0;

  while (attempts < 120) {
    const res = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
      method: "GET",
      headers,
    });

    const payload = (await res.json()) as OpenAiRun;

    if (payload.status === "requires_action" && payload.required_action?.submit_tool_outputs) {
      const toolOutputs: Array<{ tool_call_id: string; output: string }> = [];

      for (const call of payload.required_action.submit_tool_outputs.tool_calls) {
        if (call.type !== "function" || call.function?.name !== "httpClient") continue;

        let args: HttpRequestParams = { url: "", method: "GET" };

        try {
          args = JSON.parse(call.function?.arguments ?? "{}") as HttpRequestParams;
          
          // Platzhalter in Headers durch echte Credentials ersetzen
          if (args.headers) {
            const replacedHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(args.headers)) {
              replacedHeaders[key] = replacePlaceholders(value, credentials);
            }
            args.headers = replacedHeaders;
          }
        } catch {
          // Ignoriere Parsing-Fehler und nutze Default-Args
        }

        const output = await httpRequestTool(args);
        toolOutputs.push({
          tool_call_id: call.id,
          output: JSON.stringify(output),
        });
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

  const assistant = await createAuthFlowAssistant(baseUrl, headers, "gpt-4.1");
  const thread = await createThread(baseUrl, headers);

  await postUserMessage(
    baseUrl,
    headers,
    thread,
    buildAuthFlowPrompt(params),
  );

  const run = await createRun(baseUrl, headers, thread, assistant.id);
  
  // Credentials für Platzhalter-Ersetzung bereitstellen
  const credentials = {
    email: params.email,
    apiToken: params.apiToken,
    password: params.password,
    clientId: undefined, // TODO: clientId und clientSecret aus params hinzufügen wenn nötig
    clientSecret: undefined,
  };
  
  await processAuthRun(baseUrl, headers, thread, run.id, credentials);

  const msg = await fetchLatestAssistantMessage(baseUrl, headers, thread);
  const result = parseAuthFlowResponse(extractMessageText(msg));

  return result;
};
