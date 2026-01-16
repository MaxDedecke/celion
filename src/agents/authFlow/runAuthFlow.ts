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
- **CRITICAL:** If the Auth Scheme contains an 'apiBaseUrl' (e.g. "https://api.notion.com"), USE IT as the base for your requests instead of the provided 'Target URL'.
- Include any global 'headers' defined in the Auth Scheme (e.g. 'Notion-Version') in your requests.
- Construct the correct authentication headers based on 'type':
  - **type: "bearer"**: Header "Authorization" = "<tokenPrefix><API_TOKEN>" (usually "Bearer <API_TOKEN>")
  - **type: "header"**: Header "<headerName>" = "<tokenPrefix><API_TOKEN>"
  - **type: "basic"**: Header "Authorization" = "Basic <CREDENTIALS_BASE64>"
- Use the 'http_probe' tool to call the 'whoami' endpoint defined in the scheme.
- **MANDATORY:** You MUST provide the 'headers' object in the 'http_probe' tool call, containing the auth headers.

IMPORTANT SECURITY INSTRUCTIONS:
- Do NOT use real credential values in your tool calls.
- Use the placeholder "<API_TOKEN>" where the API Token is required (e.g. in Bearer or Private-Token headers).
- Use the placeholder "<EMAIL>" where the Email is required.
- For Basic Auth, use the placeholder "<CREDENTIALS_BASE64>" which represents 'base64(email:apiToken)'.
  Example: "Authorization": "Basic <CREDENTIALS_BASE64>"

- If 'tokenPrefix' is an empty string in the scheme, DO NOT add "Bearer " or any other prefix. Use the token placeholder directly.
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
            console.log(`[AuthAgent] Requesting probe for ${args.url}`);
            console.log(`[AuthAgent] Proposed Headers (Placeholder):`, JSON.stringify(args.headers, null, 2));

            // Forcefully inject headers if missing or empty, based on authScheme
            if (!args.headers || Object.keys(args.headers).length === 0) {
                console.log("[AuthAgent] Headers missing/empty. Constructing from scheme fallback...");
                args.headers = args.headers || {};
                
                // authScheme IS the authentication object + extras (from worker.ts)
                const auth = authScheme; 
                
                if (auth) {
                    if (auth.type === 'bearer') {
                        // Default to Bearer if tokenPrefix is undefined, else use it (even if empty)
                        const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : 'Bearer ';
                        args.headers['Authorization'] = `${prefix}<API_TOKEN>`;
                    } else if (auth.type === 'header') {
                        const name = auth.headerName || 'Authorization';
                        const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : '';
                        args.headers[name] = `${prefix}<API_TOKEN>`;
                    } else if (auth.type === 'basic') {
                        args.headers['Authorization'] = 'Basic <CREDENTIALS_BASE64>';
                    }
                }
                
                // Also inject global headers if present
                if (auth.headers) {
                    args.headers = { ...args.headers, ...auth.headers };
                }
            }

            // Inject actual credentials into headers
            if (args.headers) {
              for (const [key, value] of Object.entries(args.headers)) {
                if (typeof value === 'string') {
                  // Cast to string to satisfy TS
                  const strValue = value as string;
                  args.headers[key] = strValue
                    .replace('<API_TOKEN>', token)
                    .replace('<EMAIL>', email)
                    .replace('<CREDENTIALS_BASE64>', base64Credentials);
                }
              }
            }
            
            // Log masked headers for debugging
            const maskedHeaders = { ...args.headers };
            if (maskedHeaders.Authorization) maskedHeaders.Authorization = "[MASKED]";
            if (maskedHeaders['PRIVATE-TOKEN']) maskedHeaders['PRIVATE-TOKEN'] = "[MASKED]";
            console.log(`[AuthAgent] Sending Headers:`, JSON.stringify(maskedHeaders, null, 2));

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