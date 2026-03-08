import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, ChatMessage, Tool, ChatResponse, ToolCall } from './LlmProvider';
import { Pool } from 'pg';

export const resolveAnthropicConfig = async () => {
  const isServer = typeof window === 'undefined';
  
  if (isServer) {
    try {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const { rows } = await pool.query(
        "SELECT provider, model, api_key FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1"
      );
      if (rows && rows.length > 0) {
        const settings = rows[0];
        const apiKey = settings.api_key?.trim() || process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
        const model = settings.model || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
        
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY_MISSING: Kein API-Key gefunden.");
        
        return { apiKey, model };
      }
    } catch (error: any) {
      if (error.message?.startsWith("ANTHROPIC_API_KEY_MISSING")) throw error;
      console.error("Failed to fetch LLM settings from DB, falling back to ENV:", error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const env = isServer ? process.env : import.meta.env;

  const apiKey = (env.VITE_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY_MISSING: Kein API-Key gefunden.");

  const model = env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

  return { apiKey, model };
};

export class AnthropicProvider implements LlmProvider {
  async chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<ChatResponse> {
    const { apiKey, model } = await resolveAnthropicConfig();
    
    // Use dangerouslyAllowBrowser if we might run in browser without backend proxy
    const isBrowser = typeof window !== 'undefined';
    const anthropic = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: isBrowser
    });

    const systemMessage = messages.find(m => m.role === 'system')?.content || undefined;
    
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content || ''
      }));

    const response = await anthropic.messages.create({
      model: model,
      max_tokens: options?.max_tokens || 4096,
      system: systemMessage,
      messages: anthropicMessages,
      ...options
    });

    // Handle tool calls if any exist in the response
    // Basic mapping for Anthropic
    const textContent = response.content.find(c => c.type === 'text');
    let content = '';
    if (textContent && 'text' in textContent) {
        content = textContent.text;
    }

    return {
      content: content,
      // toolCalls: mapping logic here
      usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens
      } : undefined,
      raw: response
    };
  }
}
