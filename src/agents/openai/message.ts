// src/agents/openai/message.ts

import { OpenAiMessage, OpenAiMessageContent } from "./types";

export const fetchLatestAssistantMessage = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
): Promise<OpenAiMessage | null> => {
  const r = await fetch(`${baseUrl}/threads/${threadId}/messages?limit=5`, {
    method: "GET",
    headers,
  });
  const json = await r.json();
  return json.data.find((m: OpenAiMessage) => m.role === "assistant") || null;
};

export const extractMessageText = (message: OpenAiMessage | null): string => {
  if (!message) throw new Error("No assistant message");
  const chunks = message.content
    .map((c: OpenAiMessageContent) =>
      typeof c.text === "string" ? c.text : c.text?.value || c.input_text || "")
    .filter(Boolean);
  return chunks.join("\n").trim();
};

export const extractJson = (text: string) => {
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f) return f[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end >= 0) return text.slice(start, end + 1);

  return text;
};
