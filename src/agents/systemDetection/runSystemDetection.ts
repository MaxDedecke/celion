// src/agents/systemDetection/runSystemDetection.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createSystemDetectionAssistant } from "./assistant";
import { buildSystemDetectionPrompt } from "./prompt";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { parseSystemDetectionResponse } from "./parser";
import { curlHeadProbeTool } from "../openai/curlHeadTool";
import { httpRequestTool } from "../openai/httpTool";
import type { CurlHeadProbeParams, CurlHeadProbeResponse, HttpRequestParams } from "../../types/agents";
import type { OpenAiRun } from "../openai/types";

const processSystemDetectionRun = async (
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

        if (call.function?.name === "curl_head_probe") {
          let args: CurlHeadProbeParams = { url: "" } as CurlHeadProbeParams;

          try {
            args = JSON.parse(call.function?.arguments ?? "{}") as CurlHeadProbeParams;
          } catch {
            // ignore parsing error
          }

          const output = (await curlHeadProbeTool(args)) as CurlHeadProbeResponse;
          toolOutputs.push({ tool_call_id: call.id, output: JSON.stringify(output) });
        }

        if (call.function?.name === "http_probe") {
          let args: HttpRequestParams = { url: "", method: "GET" };

          try {
            args = JSON.parse(call.function?.arguments ?? "{}") as HttpRequestParams;
          } catch {
            // ignore parsing error
          }

          const output = await httpRequestTool(args);
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
      throw new Error(payload.last_error?.message || `System Detection Run failed: ${payload.status}`);
    }

    attempts++;
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error("System Detection Run timeout");
};

export const runSystemDetection = async (url: string, expectedSystem?: string) => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const assistant = await createSystemDetectionAssistant(baseUrl, headers, "gpt-4.1-mini");
  const thread = await createThread(baseUrl, headers);

  await postUserMessage(
    baseUrl,
    headers,
    thread,
    buildSystemDetectionPrompt(url, expectedSystem),
  );

  const run = await createRun(baseUrl, headers, thread, assistant.id);
  await processSystemDetectionRun(baseUrl, headers, thread, run.id);

  const msg = await fetchLatestAssistantMessage(baseUrl, headers, thread);
  return parseSystemDetectionResponse(extractMessageText(msg));
};
