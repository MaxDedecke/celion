import { curlHeadProbe } from 'src/tools/curlHeadProbe';
import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Identify the software system at the target URL.
Check HTTP headers, HTML content, and API endpoints.
Use 'curl_head_probe' first for headers. Use 'http_probe' for HTML/API checks if needed.
Compare with 'Expected System'.

Return JSON:
{
  "systemMatchesUrl": boolean,
  "apiTypeDetected": "REST" | "GraphQL" | "SOAP" | "gRPC" | "unknown",
  "apiSubtype": string | null,
  "recommendedBaseUrl": string | null,
  "confidenceScore": number,
  "detectionEvidence": {
    "headers": string[],
    "status_codes": { "path": string, "code": number }[],
    "redirects": string[],
    "notes": string
  },
  "rawOutput": string
}
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "curl_head_probe",
      description: "Inspects HTTP headers/redirects via HEAD.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          headers: { type: "object" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "http_probe",
      description: "Inspects body via GET/POST.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "HEAD"] },
          headers: { type: "object" },
          body: { type: "string" }
        },
        required: ["url"]
      }
    }
  }
];

export async function* runSystemDetection(url: string, system: string, instructions?: string): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = await resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `URL: ${url}\nExpected: ${system || '?'}\nHints: ${instructions || '-'}` }
  ];

  // OpenAI Chat Completions Loop
  while (true) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools: TOOLS,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    // Append assistant message to history
    messages.push(message);

    // Yield content if present
    if (message.content) {
      yield {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message.content }]
      };
    }

    // Handle Tool Calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let result: any;

        try {
          if (functionName === 'curl_head_probe') {
            result = await curlHeadProbe(args);
          } else if (functionName === 'http_probe') {
            result = await httpClient(args);
            // Aggressive truncation to prevent context length errors
            if (result.body) {
              const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
              if (bodyStr.length > 2000) {
                result.body = bodyStr.slice(0, 2000) + '...[TRUNCATED]';
              }
            }
          } else {
            result = { error: `Unknown tool: ${functionName}` };
          }
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }

        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: JSON.stringify(result)
        });
      }
    } else {
      // No tool calls, we are done
      break;
    }
  }
}
