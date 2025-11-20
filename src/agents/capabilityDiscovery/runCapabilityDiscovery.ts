// src/agents/capabilityDiscovery/runCapabilityDiscovery.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createCapabilityDiscoveryAssistant } from "./assistant";
import { buildCapabilityDiscoveryPrompt } from "./prompt";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { parseCapabilityDiscoveryResponse } from "./parser";
import { httpRequestTool } from "../openai/httpTool";

import type {
  CapabilityDiscoveryResult,
  HttpRequestParams,
  HttpResponse,
  ApiSpecAnalysis,
} from "@/types/agents";
import { OpenAiRun } from "../openai/types";

type AgentExecutionOptions = { signal?: AbortSignal };

const processCapabilityRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<OpenAiRun> => {
  let attempts = 0;

  while (attempts < 120) {
    const res = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
      method: "GET",
      headers,
      signal,
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
          // fallback
        }

        const output = await httpRequestTool(args);
        toolOutputs.push({
          tool_call_id: call.id,
          output: JSON.stringify(output),
        });
      }

      if (toolOutputs.length > 0) {
        await fetch(
          `${baseUrl}/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ tool_outputs: toolOutputs }),
            signal,
          }
        );
      }
    }

    else if (payload.status === "completed") {
      return payload;
    }

    else if (["failed", "cancelled", "expired"].includes(payload.status)) {
      throw new Error(
        payload.last_error?.message ||
          `Capability Discovery Run failed: ${payload.status}`
      );
    }

    attempts++;
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Capability Discovery Run timeout");
};

export const runCapabilityDiscovery = async (
  baseUrl: string,
  system: string,
  apiToken: string,
  email?: string,
  password?: string,
  options: AgentExecutionOptions = {},
): Promise<CapabilityDiscoveryResult> => {
  if (!baseUrl?.trim()) throw new Error("Capability Agent benötigt eine Base-URL");

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const { apiKey, baseUrl: openAiBaseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  // 1) Assistant & Thread
  const assistant = await createCapabilityDiscoveryAssistant(
    openAiBaseUrl,
    headers,
    "gpt-4.1"
  );

  const threadId = await createThread(openAiBaseUrl, headers);

  // 2) Prompt senden
  const prompt = buildCapabilityDiscoveryPrompt(system, normalizedBase, {
    apiToken,
    email,
    password,
  });

  await postUserMessage(openAiBaseUrl, headers, threadId, prompt);

  // 3) Run starten
  const run = await createRun(openAiBaseUrl, headers, threadId, assistant.id);

  await processCapabilityRun(
    openAiBaseUrl,
    headers,
    threadId,
    run.id,
    options.signal
  );

  // 4) Final Response holen
  const msg = await fetchLatestAssistantMessage(openAiBaseUrl, headers, threadId);
  const text = extractMessageText(msg);

  return parseCapabilityDiscoveryResponse(text);
};
