// src/agents/openai/openaiClient.ts

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";


export const resolveOpenAiConfig = () => {
  const isServer = typeof window === 'undefined';
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const env = isServer ? process.env : import.meta.env;

  const apiKey = env.VITE_OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY fehlt");

  const baseUrl = (env.VITE_OPENAI_API_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const projectId = env.VITE_OPENAI_PROJECT_ID?.trim();

  return { apiKey, baseUrl, projectId };
};

export const buildOpenAiHeaders = (apiKey: string, projectId?: string) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (projectId) headers["OpenAI-Project"] = projectId;
  return headers;
};
