import { httpClient } from 'src/tools/httpRequest';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
You are a deterministic Data Discovery Engine. Your goal is a 100% accurate and COMPLETE inventory of the provided system structure.

### PHASE 1: EXPLORATION (Tool use)
- **COMPLETENESS MANDATE:** You MUST traverse every level of the hierarchy as defined in the provided 'System Scheme'. An inventory is only complete when no branch or endpoint defined in the scheme remains unexplored.
- **TOTAL COVERAGE:** Ensure you execute calls for all entity types listed in 'discovery.endpoints' (e.g., users, containers, work items).
- **SYSTEM-SPECIFIC LOGIC:** Strictly follow all instructions provided in the 'agentInstructions' field and any [REQ-X] markers within the scheme. These contain the rules for navigating that specific system's quirks.
- During exploration, respond ONLY with brief status updates in German in the 'content' field (e.g., "Analysiere Ebene X...", "Erfasse Metadaten...").
- **ID INTEGRITY:** Use only IDs obtained from previous tool outputs.

### PHASE 2: FINAL REPORT (No more tool calls)
- Once every part of the system has been explored, provide EXACTLY ONE valid JSON object. 
- Do NOT include any 'content' text or additional JSON blocks in the final response.

### FINAL JSON FORMAT:
{
  "entities": [
    { "name": "string", "count": number, "complexity": "low" | "medium" | "high" }
  ],
  "estimatedDurationMinutes": number,
  "complexityScore": number,
  "executedCalls": ["string"],
  "scope": { "identified": boolean, "name": string | null, "id": string | null, "type": string | null },
  "summary": "Short German summary.",
  "rawOutput": "Technical coverage summary."
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
