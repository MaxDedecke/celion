// src/agents/openai/run.ts

import { OpenAiRun } from "./types";

export const createRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  assistantId: string,
): Promise<OpenAiRun> => {
  const r = await fetch(`${baseUrl}/threads/${threadId}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: assistantId }),
  });

  const json = await r.json();
  if (!json.id) throw new Error("Run creation failed");
  return json as OpenAiRun;
};

export const waitForRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
): Promise<OpenAiRun> => {
  let attempts = 0;
  while (attempts < 90) {
    const r = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, { headers });
    const json = (await r.json()) as OpenAiRun;

    if (json.status === "completed") return json;
    if (["failed", "cancelled", "expired"].includes(json.status)) {
      throw new Error(json.last_error?.message || `Run failed: ${json.status}`);
    }

    await new Promise(r => setTimeout(r, 1000));
    attempts++;
  }
  throw new Error("Run timed out");
};
