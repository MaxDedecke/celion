import { curlHeadProbe } from 'src/tools/curlHeadProbe';
import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
You are a system detection expert. Your task is to identify the software system running at a given URL.
You should check for common signatures in HTTP headers, HTML content, and specific API endpoints.

Use the available tools 'curl_head_probe' and 'http_probe' to gather information.
- Start with 'curl_head_probe' to check headers (e.g. Server, X-Powered-By, Set-Cookie).
- If inconclusive, use 'http_probe' to check HTML content or specific API endpoints (e.g. /rest/api/2/serverInfo for Jira).

Compare your findings with the 'Expected System' if provided.

Return the result in the following JSON format:
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
      description: "Performs a HEAD request to inspect HTTP headers and redirects.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to probe." },
          headers: { type: "object", description: "Optional headers to include." }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "http_probe",
      description: "Performs a full HTTP request (GET/POST) to inspect body/content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to probe." },
          method: { type: "string", enum: ["GET", "POST", "HEAD", "PUT", "DELETE"], description: "HTTP method." },
          headers: { type: "object", description: "Optional headers." },
          body: { type: "string", description: "Optional body content." }
        },
        required: ["url"]
      }
    }
  }
];

export async function* runSystemDetection(url: string, system: string, instructions?: string): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Target URL: ${url}\nExpected System: ${system || 'Not specified'}\nHints: ${instructions || 'None'}` }
  ];

  // OpenAI Chat Completions Loop
  while (true) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: "gpt-4o", // Or generic, using standard model
        messages,
        tools: TOOLS,
        response_format: { type: "json_object" } // Using json_object to ensure valid JSON
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
