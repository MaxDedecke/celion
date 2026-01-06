// src/agents/openai/run.ts

import { OpenAiResponse } from './types';

export const createResponse = async (
  baseUrl: string,
  headers: Record<string, string>,
  conversationId: string,
  params: { input: any[]; tools?: any[]; model?: string },
): Promise<OpenAiResponse> => {
  const body = {
    conversation_id: conversationId,
    input: params.input,
    tools: params.tools,
    model: params.model,
  };

  const r = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Create response failed: ${r.status} ${r.statusText} ${errorText}`);
  }

  return (await r.json()) as OpenAiResponse;
};