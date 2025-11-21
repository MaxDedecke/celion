// src/agents/authFlow/runAuthFlow.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun, waitForRun, submitToolOutputs } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { httpRequestTool } from "../openai/httpTool";

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

  let run = await createRun(baseUrl, headers, thread, assistant.id);
  run = await waitForRun(baseUrl, headers, thread, run.id);

  // Handle tool calls if required
  if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
    const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
    const toolOutputs = [];

    for (const toolCall of toolCalls) {
      if (toolCall.function.name === "httpRequest") {
        const args = JSON.parse(toolCall.function.arguments);
        const response = await httpRequestTool(args);
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(response),
        });
      }
    }

    if (toolOutputs.length > 0) {
      await submitToolOutputs(baseUrl, headers, thread, run.id, toolOutputs);
      run = await waitForRun(baseUrl, headers, thread, run.id);
    }
  }

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
