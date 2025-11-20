// src/agents/systemDetection/runSystemDetection.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openaiClient";
import { createSystemDetectionAssistant } from "./assistant";
import { buildSystemDetectionPrompt } from "./prompt";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun, waitForRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { parseSystemDetectionResponse } from "./parser";

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
  await waitForRun(baseUrl, headers, thread, run.id);

  const msg = await fetchLatestAssistantMessage(baseUrl, headers, thread);
  return parseSystemDetectionResponse(extractMessageText(msg));
};
