import { Conversation } from './types';

export const createConversation = async (
  baseUrl: string,
  headers: Record<string, string>,
  params: {
    promptId: string;
    promptParameters: Record<string, string>;
  }
): Promise<Conversation> => {
  const r = await fetch(`${baseUrl}/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Conversation creation failed: ${r.status} ${r.statusText} ${errorText}`);
  }

  return (await r.json()) as Conversation;
};
