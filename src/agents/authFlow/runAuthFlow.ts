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

const processAuthRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
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
  await processAuthRun(baseUrl, headers, thread, run.id);

  const msg = await fetchLatestAssistantMessage(baseUrl, headers, thread);
  const result = parseAuthFlowResponse(extractMessageText(msg));

  /*     await supabase
    .from("migration_connectors")
    .update({
        auth_headers: result.auth_headers,
    })
    .eq("id", connectorId);

 */
  return result;
};
