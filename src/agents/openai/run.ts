import { OpenAiResponse } from './types';

export const createResponse = async (
  baseUrl: string,
  headers: Record<string, string>,
  params: {
    conversationId: string;
    items?: any[];
  }
): Promise<OpenAiResponse> => {
  const r = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Create response failed: ${r.status} ${r.statusText} ${errorText}`);
  }

  return (await r.json()) as OpenAiResponse;
};