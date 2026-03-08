import { GoogleGenerativeAI } from '@google/generative-ai';
import { LlmProvider, ChatMessage, Tool, ChatResponse, ToolCall } from './LlmProvider';
import { Pool } from 'pg';

export const resolveGeminiConfig = async () => {
  const isServer = typeof window === 'undefined';
  
  if (isServer) {
    try {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const { rows } = await pool.query(
        "SELECT provider, model, api_key FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1"
      );
      if (rows && rows.length > 0) {
        const settings = rows[0];
        const apiKey = settings.api_key?.trim() || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
        const model = settings.model || process.env.GEMINI_MODEL || "gemini-1.5-pro";
        
        if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING: Kein API-Key gefunden.");
        
        return { apiKey, model };
      }
    } catch (error: any) {
      if (error.message?.startsWith("GEMINI_API_KEY_MISSING")) throw error;
      console.error("Failed to fetch LLM settings from DB, falling back to ENV:", error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const env = isServer ? process.env : import.meta.env;

  const apiKey = (env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY)?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING: Kein API-Key gefunden.");

  const model = env.GEMINI_MODEL || "gemini-1.5-pro";

  return { apiKey, model };
};

export class GoogleGeminiProvider implements LlmProvider {
  async chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<ChatResponse> {
    const { apiKey, model } = await resolveGeminiConfig();
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model: model });
    
    // Convert standard chat messages to Gemini format
    const systemMessage = messages.find(m => m.role === 'system')?.content || undefined;
    
    // Filter out system message and format others
    const geminiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }]
      }));
      
    // Tools could be mapped here if needed
    // For simplicity, we implement a basic chat request
    const requestOptions: any = {
       contents: geminiMessages,
    };
    
    if (systemMessage) {
        requestOptions.systemInstruction = {
            parts: [{ text: systemMessage }]
        };
    }
    
    const result = await geminiModel.generateContent(requestOptions);
    const response = await result.response;
    const text = response.text();
    
    return {
      content: text,
      // toolCalls: mapping logic here
      raw: response
    };
  }
}
