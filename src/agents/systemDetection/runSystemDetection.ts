import { createConversation } from 'src/agents/openai/conversation';
import { createResponse } from 'src/agents/openai/run';
import { curlHeadProbe } from 'src/tools/curlHeadProbe';
import { httpClient } from 'src/tools/httpRequest';
import { Conversation, Message, ToolCall } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const PROMPT_ID = 'pmpt_695d2ee1881c8193a303f787274959d906011a1106b1c53d';

function arrayToRecord(arr: { key: string; value: string }[]): Record<string, string> {
  return arr.reduce((acc, { key, value }) => {
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
}

export async function* runSystemDetection(url: string, system: string): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const conversation: Conversation = await createConversation(baseUrl, headers);

  let response = await createResponse(baseUrl, headers, {
    conversationId: conversation.id,
    promptOptions: {
      promptId: PROMPT_ID,
      variables: {
        URL: url,
        SYSTEM: system,
      },
    },
  });

  while (response.output.some((item) => item.type === 'tool_call')) {
    const toolCalls = response.output.filter((item) => item.type === 'tool_call') as ToolCall[];
    const toolResults = [];

    for (const toolCall of toolCalls) {
      const { tool_name, parameters } = toolCall.tool_call;
      let result: unknown;

      try {
        if (tool_name === 'curl_head_probe') {
          const { headers = [] } = parameters;
          const headersRecord = arrayToRecord(headers);
          result = await curlHeadProbe({ url, headers: headersRecord });
        } else if (tool_name === 'http_probe') {
          const { headers = [], body, method } = parameters;
          const headersRecord = arrayToRecord(headers);
          result = await httpClient({
            url,
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
      inputs: toolResults.map((result) => ({
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
