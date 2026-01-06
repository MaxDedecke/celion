// src/agents/systemDetection/runSystemDetection.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { buildSystemDetectionPrompt } from "./prompt";
import { createConversation } from "../openai/conversation";
import { createResponse } from "../openai/run";
import { extractMessageText, extractJson } from "../openai/message";
import { parseSystemDetectionResponse, SystemDetectionResult } from "./parser";
import { curlHeadProbeTool } from "../openai/curlHeadTool";
import { httpRequestTool } from "../openai/httpTool";
import { getSystemDetectionConfig } from "./assistant";
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

  const { instructions, tools } = getSystemDetectionConfig(expectedSystem);
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