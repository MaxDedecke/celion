import { Conversation, createConversation } from 'src/agents/openai/conversation';
import { createResponse } from 'src/agents/openai/run';
import { httpRequest } from 'src/tools/httpRequest';
import { Message, ToolCall } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const PROMPT_ID = 'auth-flow-v1';

function arrayToRecord(arr: { key: string; value: string }[]): Record<string, string> {
  return arr.reduce((acc, { key, value }) => {
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
}

export async function* runAuthFlow(
  url: string,
  authMethod: string,
  credentials: Record<string, string>
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const conversation: Conversation = await createConversation(baseUrl, headers, {
    promptId: PROMPT_ID,
    promptParameters: {
      URL: url,
      AUTH_METHOD: authMethod,
      CREDENTIALS: JSON.stringify(credentials),
    },
  });

  let response = await createResponse(baseUrl, headers, { conversationId: conversation.id });

  while (response.output.some((item) => item.type === 'tool_call')) {
    const toolCalls = response.output.filter((item) => item.type === 'tool_call') as ToolCall[];
    const toolResults = [];

    for (const toolCall of toolCalls) {
      const { tool_name, parameters } = toolCall.tool_call;
      let result: unknown;

      try {
        if (tool_name === 'httpClient') {
          const { headers = [], body, method, url: toolUrl } = parameters;
          const headersRecord = arrayToRecord(headers);
          result = await httpRequest({
            url: toolUrl,
            method,
            headers: headersRecord,
            body,
          });
        } else {
          throw new Error(`Unknown tool: ${tool_name}`);
        }

        toolResults.push({
          tool_call_id: toolCall.tool_call.id,
          output: JSON.stringify(result),
        });
      } catch (error) {
        toolResults.push({
          tool_call_id: toolCall.tool_call.id,
          output: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        });
      }
    }

    response = await createResponse(baseUrl, headers, {
      conversationId: conversation.id,
      items: toolResults.map((result) => ({
        type: 'tool_result',
        tool_result: {
          id: result.tool_call_id,
          output: result.output,
        },
      })),
    });
  }

  for (const item of response.output) {
    if (item.type === 'message') {
      yield item;
    }
  }
}
