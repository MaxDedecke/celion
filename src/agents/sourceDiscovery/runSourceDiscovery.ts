import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
You are a Data Discovery Expert. Your task is to explore a source system (e.g. ClickUp, Asana, Jira) and identify the quantity and structure of data to be migrated.

You will be provided with:
1. Source URL
2. Credentials (Email, API Token)
3. System Scheme (Configuration from the system's spec file)
4. Scope Config (Optional: specific Project Name or ID to focus on)

Your goal:
- Explore the hierarchy of the system (e.g., Teams -> Spaces -> Folders -> Lists -> Tasks).
- **COST EFFICIENCY IS CRITICAL:** 
  - Do NOT fetch all tasks. 
  - Use endpoints that provide summaries or counts.
  - If a "total" or "count" is available in headers or response body, use it.
  - If you must query items, use 'limit=1' to see if items exist and check for 'total' fields in the response.
- **SCOPE AWARENESS:** 
  - If a 'sourceScope' is provided, find that specific container (by ID or Name) and ONLY discover data within it.
  - If no 'sourceScope' is provided, provide a summary of the entire accessible system.

Interactive Progress:
- You should provide brief status updates in your 'content' before or after tool calls (e.g., "I found 3 Teams, exploring the first one...", "Scanning for Tasks in List 'Development'...").
- Speak in German for the content updates.

IMPORTANT SECURITY INSTRUCTIONS:
- Do NOT use real credential values in your tool calls.
- Use the placeholder "<API_TOKEN>" where the API Token is required (e.g. in Bearer or Private-Token headers).
- Use the placeholder "<EMAIL>" where the Email is required.
- For Basic Auth, use the placeholder "<CREDENTIALS_BASE64>" which represents 'base64(email:apiToken)'.
  Example: "Authorization": "Basic <CREDENTIALS_BASE64>"

Tools:
- Use the 'http_probe' tool to call endpoints defined in the scheme.
- Include necessary authentication headers (calculated by the agent infrastructure, but you must specify where they go).

Final Result:
Return the discovery report in the following JSON format:
{
  "entities": [
    { "name": "Tasks", "count": number, "complexity": "low" | "medium" | "high" },
    { "name": "Lists", "count": number },
    ...
  ],
  "error": string | null,
  "scope": {
    "identified": boolean,
    "name": string | null,
    "id": string | null
  },
  "summary": "String describing the findings in German.",
  "rawOutput": "Brief summary of API responses used."
}
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "http_probe",
      description: "Performs an HTTP request to explore the system.",
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

export async function* runSourceDiscovery(
  url: string,
  systemScheme: any,
  credentials: { email?: string; apiToken?: string },
  scopeConfig?: { sourceScope?: string }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const email = credentials.email || "";
  const token = credentials.apiToken || "";
  const base64Credentials = btoa(`${email}:${token}`);

  const userContext = `
Source URL: ${url}
Credentials: ${credentials.email ? 'Email provided' : 'No email'}, Token provided
System Scheme: ${JSON.stringify(systemScheme, null, 2)}
Scope Config: ${JSON.stringify(scopeConfig || {}, null, 2)}
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
        model: "gpt-4o",
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
            // Forcefully inject headers if missing or empty, based on systemScheme
            if (!args.headers || Object.keys(args.headers).length === 0) {
                args.headers = args.headers || {};
                const auth = systemScheme?.authentication;
                
                if (auth) {
                    if (auth.type === 'bearer') {
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
                if (systemScheme?.headers) {
                    args.headers = { ...args.headers, ...systemScheme.headers };
                }
            }

            // Inject Actual Credentials
            if (args.headers) {
              for (const [key, value] of Object.entries(args.headers)) {
                if (typeof value === 'string') {
                  const strValue = value as string;
                  args.headers[key] = strValue
                    .replace('<API_TOKEN>', token)
                    .replace('<EMAIL>', email)
                    .replace('<CREDENTIALS_BASE64>', base64Credentials);
                }
              }
            }

            result = await httpClient(args);
            
            // Truncate body if too large for LLM context
            if (result.body) {
              const bodyStr = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
              if (bodyStr.length > 15000) {
                result.body = bodyStr.slice(0, 15000) + '...[TRUNCATED BY AGENT]';
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
