import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
You are an authentication expert. Your task is to verify if the provided credentials (Email and API Token) 
work for a specific target system and URL.

You will be provided with:
1. Target URL
2. Credentials (Email, API Token)
3. Auth Scheme (Configuration from the system's spec file)

Your goal:
- STRICTLY follow the 'authentication' section in the Auth Scheme.
- Construct the correct authentication headers as defined in the scheme.
- Use the 'http_probe' tool to call the 'whoami' endpoint defined in the scheme.
- Verify if the response is successful (usually 200 OK).
- Extract the user's display name or username if possible (using 'usernamePath' from scheme if available).

IMPORTANT:
- If 'tokenPrefix' is an empty string in the scheme, DO NOT add "Bearer " or any other prefix. Use the token exactly as is.
- If 'headerName' is specified (e.g. 'PRIVATE-TOKEN'), use that exact header name.

Return the result in the following JSON format:
{
  "success": boolean,
  "authenticatedAs": string | null,
  "status": number | null,
  "error": string | null,
  "rawOutput": string
}
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "http_probe",
      description: "Performs an HTTP request to verify credentials.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL to probe." },
          method: { type: "string", enum: ["GET", "POST"], description: "HTTP method." },
          headers: { type: "object", description: "Authentication and other headers." },
          body: { type: "string", description: "Optional body." }
        },
        required: ["url"]
      }
    }
  }
];

export async function* runAuthFlow(
  url: string,
  authScheme: any,
  credentials: { email?: string; apiToken?: string }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
Target URL: ${url}
Email: ${credentials.email || 'Not provided'}
API Token: ${credentials.apiToken ? 'PROVIDED' : 'MISSING'}
Auth Scheme: ${JSON.stringify(authScheme, null, 2)}
  `;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContext }
  ];

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

    messages.push(message);

    if (message.content) {
      yield {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message.content }]
      };
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let result: any;

        try {
          if (functionName === 'http_probe') {
            result = await httpClient(args);
            // Truncate large bodies
            if (result.body) {
              const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
              if (bodyStr.length > 10000) {
                result.body = bodyStr.slice(0, 10000) + '...[TRUNCATED BY AGENT]';
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
      break;
    }
  }
}