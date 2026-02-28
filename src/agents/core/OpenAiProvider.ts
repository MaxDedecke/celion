import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { LlmProvider, ChatMessage, Tool } from './LlmProvider';

export class OpenAiProvider implements LlmProvider {
  async chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<any> {
    const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
    const openAiHeaders = buildOpenAiHeaders(apiKey, projectId);
    
    const body: any = {
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages,
      ...options
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: openAiHeaders,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    return await response.json();
  }
}
