// src/agents/openai/openaiClient.ts

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_ASSISTANTS_HEADER = "assistants=v2";

export const resolveOpenAiConfig = () => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY fehlt");

  const baseUrl = (import.meta.env.VITE_OPENAI_API_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const projectId = import.meta.env.VITE_OPENAI_PROJECT_ID?.trim();

  return { apiKey, baseUrl, projectId };
};

export const buildOpenAiHeaders = (apiKey: string, projectId?: string) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": OPENAI_ASSISTANTS_HEADER,
  };
  if (projectId) headers["OpenAI-Project"] = projectId;
  return headers;
};
