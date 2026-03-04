// src/agents/openai/openaiClient.ts
import { Pool } from 'pg';

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const resolveOpenAiConfig = async () => {
  const isServer = typeof window === 'undefined';
  
  if (isServer) {
    try {
      const { rows } = await pool.query(
        "SELECT provider, model, base_url, api_key FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1"
      );
      if (rows && rows.length > 0) {
        const settings = rows[0];
        const apiKey = settings.api_key?.trim() || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
        const baseUrl = (settings.base_url?.trim() || process.env.VITE_OPENAI_API_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
        const projectId = process.env.VITE_OPENAI_PROJECT_ID?.trim();
        const model = settings.model || process.env.OPENAI_MODEL || "gpt-4o";
        
        if (!apiKey) throw new Error("API_KEY fehlt (nicht in DB und nicht in ENV)");
        
        return { apiKey, baseUrl, projectId, model };
      }
    } catch (error) {
      console.error("Failed to fetch LLM settings from DB, falling back to ENV:", error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const env = isServer ? process.env : import.meta.env;

  const apiKey = (env.VITE_OPENAI_API_KEY || env.OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY fehlt");

  const baseUrl = (env.VITE_OPENAI_API_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const projectId = env.VITE_OPENAI_PROJECT_ID?.trim();
  const model = env.OPENAI_MODEL || "gpt-4o";

  return { apiKey, baseUrl, projectId, model };
};

export const buildOpenAiHeaders = (apiKey: string, projectId?: string) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (projectId) headers["OpenAI-Project"] = projectId;
  return headers;
};
