// src/agents/openai/message.ts

import { OpenAiResponse, Message } from './types';

/**
 * Extracts and concatenates the text content from assistant messages in an OpenAI response.
 * @param response The response object from the OpenAI API.
 * @returns A single string containing all the assistant's text replies, trimmed.
 */
export const extractTextFromResponse = (response: OpenAiResponse): string => {
  return response.output
    .filter((item): item is Message => item.type === 'message' && item.role === 'assistant')
    .map(item => item.content.map(c => c.text).join(''))
    .join('\n')
    .trim();
};

/**
 * Fetches all items (messages, tool calls, etc.) for a given conversation.
 * @param baseUrl The base URL of the API.
 * @param headers The request headers.
 * @param conversationId The ID of the conversation to fetch.
 * @returns A promise that resolves to an OpenAiResponse object containing the conversation items.
 */
export const fetchConversationItems = async (
  baseUrl: string,
  headers: Record<string, string>,
  conversationId: string
): Promise<OpenAiResponse> => {
  const r = await fetch(`${baseUrl}/conversations/${conversationId}/items`, {
    method: 'GET',
    headers,
  });

  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Fetching conversation items failed: ${r.status} ${r.statusText} ${errorText}`);
  }

  // Assuming the response from this endpoint matches the OpenAiResponse structure
  return (await r.json()) as OpenAiResponse;
};

/**
 * Extracts a JSON string from a block of text, looking for markdown code blocks
 * or the first and last curly braces.
 * @param text The text to search for a JSON string.
 * @returns The extracted JSON string, or the original text if no JSON is found.
 */
export const extractJson = (text: string) => {
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f) return f[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end >= 0) return text.slice(start, end + 1);

  return text;
};