import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { LlmProvider, ChatMessage, Tool, ChatResponse } from './LlmProvider';

export class OpenAiProvider implements LlmProvider {
  async chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<ChatResponse> {
    const { apiKey, baseUrl, projectId, model } = await resolveOpenAiConfig();
    const openAiHeaders = buildOpenAiHeaders(apiKey, projectId);
    
    const body: any = {
      model: model,
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

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    return {
      content: message.content,
      toolCalls: message.tool_calls,
      usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
      } : undefined,
      raw: data
    };
  }
}
