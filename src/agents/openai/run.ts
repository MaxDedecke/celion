import { OpenAiResponse } from './types';

export const createResponse = async (
  baseUrl: string,
  headers: Record<string, string>,
  params: {
    conversationId: string;
    inputs?: any[];
    promptOptions?: {
      promptId: string;
      variables: Record<string, any>;
    };
  }
): Promise<OpenAiResponse> => {
  const body = {
    conversation: params.conversationId,
    input: params.inputs ?? [],
    prompt: params.promptOptions
      ? {
          id: params.promptOptions.promptId,
          variables: params.promptOptions.variables,
        }
      : undefined,
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