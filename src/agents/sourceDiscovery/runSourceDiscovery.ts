import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
You are a Data Discovery Expert. Your task is to perform a thorough and precise inventory of a source system (e.g. ClickUp, Asana, Jira) to identify all data structures and quantities to be migrated.

You will be provided with:
1. Source URL (Used as the base API endpoint)
2. Credentials (Email, API Token)
3. System Scheme (The hierarchical definition of the system: e.g. Teams -> Spaces -> Folders -> Lists -> Tasks)
4. Scope Config (Optional: specific Project Name or ID to focus on)

Your goal is a COMPLETE inventory based on these rules:
- **STRICT SCOPE LOGIC:** 
  - If a 'sourceScope' (ID or Name) is provided in the Scope Config, this is your absolute boundary. Find this container and ONLY analyze its contents.
  - If NO 'sourceScope' is provided, you MUST analyze the ENTIRE system accessible via the credentials. Ignore any specificity in the Source URL (e.g., if the URL points to a specific list, but no scope is set, scan the whole workspace).
- **DEPTH OF ANALYSIS:** 
  - You must traverse the entire hierarchy defined in the System Scheme until you reach the actual work items (Tasks, Pages, Documents).
  - You MUST explicitly count the number of Users/Members in the system or the selected scope.
  - Identify metadata like the number of custom statuses, tags, or priority levels if reachable via the scheme.
- **TECHNICAL EFFICIENCY:** 
  - Do NOT fetch full content of tasks. 
  - ALWAYS use endpoints or headers that provide summaries or counts (e.g., 'total', 'count', 'X-Total-Count') to avoid rate limits and latency.
  - If a count is not directly available, use 'limit=1' queries to determine existence and check for pagination metadata that reveals the total count.

Interactive Progress:
- Provide brief status updates in German in your 'content' field before/after tool calls (e.g., "Ich analysiere jetzt alle verfügbaren Teams...", "Suche nach Aufgaben in Liste 'Entwicklung'...").

IMPORTANT SECURITY INSTRUCTIONS:
- Use placeholders ("<API_TOKEN>", "<EMAIL>", "<CREDENTIALS_BASE64>") in your tool calls.

Final Result:
Return the discovery report in the following JSON format:
{
  "entities": [
    { "name": "Tasks", "count": number, "complexity": "low" | "medium" | "high" },
    { "name": "Users", "count": number },
    { "name": "Spaces/Projects", "count": number },
    ...
  ],
  "error": string | null,
  "scope": {
    "identified": boolean,
    "name": string | null,
    "id": string | null,
    "type": string | null
  },
  "summary": "Detaillierte Zusammenfassung der Inventur auf Deutsch.",
  "rawOutput": "Technical summary of API coverage."
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
