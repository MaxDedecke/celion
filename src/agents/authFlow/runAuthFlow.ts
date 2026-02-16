import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Verify credentials for the target system.
Use the provided Auth Scheme instructions.
1. Use 'apiBaseUrl' if present in the scheme.
2. Construct headers based on 'type':
   - "bearer": "Authorization": "<tokenPrefix><API_TOKEN>"
   - "header": "<headerName>": "<tokenPrefix><API_TOKEN>"
   - "basic": "Authorization": "Basic <CREDENTIALS_BASE64>"
3. Call the 'whoami' endpoint defined in the scheme using 'http_probe'.
4. MANDATORY: Pass the 'headers' object to 'http_probe'.

SECURITY:
- Use placeholders <API_TOKEN>, <EMAIL>, <CREDENTIALS_BASE64> in tool calls. DO NOT send real secrets.

Return JSON:
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
      description: "Verifies credentials via HTTP request.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          headers: { type: "object" },
          body: { type: "string" }
        },
        required: ["url", "headers"]
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

  // Pre-calculate Base64 credentials for Basic Auth injection
  const email = credentials.email || "";
  const token = credentials.apiToken || "";
  const base64Credentials = btoa(`${email}:${token}`);

  // Only pass relevant auth details to save tokens
  const simplifiedScheme = {
    authentication: authScheme.authentication || authScheme,
    apiBaseUrl: authScheme.apiBaseUrl,
    headers: authScheme.headers
  };

  const userContext = `
Target: ${url}
Email: ${credentials.email ? 'PROVIDED' : 'MISSING'}
Token: ${credentials.apiToken ? 'PROVIDED' : 'MISSING'}
Scheme: ${JSON.stringify(simplifiedScheme)}
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
            console.log(`[AuthAgent] Requesting probe for ${args.url}`);
            
            // Forcefully inject headers if missing or empty, based on authScheme
            if (!args.headers || Object.keys(args.headers).length === 0) {
                args.headers = args.headers || {};
                const auth = authScheme.authentication || authScheme; 
                
                if (auth) {
                    if (auth.type === 'bearer') {
                        const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : 'Bearer ';
                        args.headers['Authorization'] = `${prefix}${token}`;
                    } else if (auth.type === 'header') {
                        const name = auth.headerName || 'Authorization';
                        const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : '';
                        args.headers[name] = `${prefix}${token}`;
                    } else if (auth.type === 'basic') {
                        args.headers['Authorization'] = `Basic ${base64Credentials}`;
                    }
                }
                if (auth.headers) {
                    Object.assign(args.headers, auth.headers);
                }
            } else {
                // Replace placeholders if headers were provided by LLM
                for (const [key, value] of Object.entries(args.headers)) {
                    if (typeof value === 'string') {
                      args.headers[key] = (value as string)
                        .replace('<API_TOKEN>', token)
                        .replace('<EMAIL>', email)
                        .replace('<CREDENTIALS_BASE64>', base64Credentials);
                    }
                }
            }

            result = await httpClient(args);
            // Aggressive truncation
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
      break;
    }
  }
}