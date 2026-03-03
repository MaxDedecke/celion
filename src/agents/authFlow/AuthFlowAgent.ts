import { AgentBase } from '../core/AgentBase';
import { Tool, ChatMessage } from '../core/LlmProvider';
import { httpClient } from '../../tools/httpRequest';
import { loadScheme } from '../../lib/scheme-loader';

export class AuthFlowAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId } = this.context;
    const url = params?.url;
    const systemName = params?.expectedSystem;
    const mode = params?.mode || 'source';
    
    const headerMsg = mode === 'source' ? "Verifiziere **Quellsystem-Authentifizierung**" : "Verifiziere **Zielsystem-Authentifizierung**";
    await this.context.writeChatMessage('assistant', headerMsg, stepNumber);
    
    const connector = await this.context.getConnector(mode === 'source' ? 'in' : 'out');

    if (!connector || (!connector.api_key && !connector.username)) {
      const failureMessage = `Keine Zugangsdaten für **${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** gefunden.`;
      return { success: false, error: failureMessage, isLogicalFailure: true, system_mode: mode };
    }

    const fullScheme = await loadScheme(systemName);
    const authScheme = { ...(fullScheme?.authentication || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
    const detailMsg = `Ich teste die Verbindung zu **${systemName}** (**${url}**) mit den hinterlegten Zugangsdaten basierend auf der Konfiguration für **${fullScheme?.system || systemName}**.`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    const email = connector.username || "";
    const token = connector.api_key || "";
    const base64Credentials = btoa(`${email}:${token}`);

    const simplifiedScheme = {
      authentication: authScheme.authentication || authScheme,
      apiBaseUrl: authScheme.apiBaseUrl,
      headers: authScheme.headers
    };

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

    const TOOLS: Tool[] = [
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

    const userContext = `
Target: ${url}
Email: ${connector.username ? 'PROVIDED' : 'MISSING'}
Token: ${connector.api_key ? 'PROVIDED' : 'MISSING'}
Scheme: ${JSON.stringify(simplifiedScheme)}
    `;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContext }
    ];

    let lastMessageText: string | undefined;

    for (let turn = 0; turn < 15; turn++) {
      const response = await this.provider.chat(messages, TOOLS, { 
          model: process.env.OPENAI_MODEL || "gpt-4o",
          response_format: { type: "json_object" } 
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.content) {
        lastMessageText = message.content;
      }

      if (message.tool_calls && message.tool_calls.length > 0) {

        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let result: any;

          try {
            if (functionName === 'http_probe') {
              console.log(`[AuthAgent] Requesting probe for ${args.url}`);
              
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

    if (lastMessageText) {
      try {
        const parsed = JSON.parse(lastMessageText);
        parsed.system_mode = mode;
        let isLogicalFailure = false;
        let failureMessage = "";

        if (parsed.success === false) {
           isLogicalFailure = true;
           failureMessage = `${mode === 'source' ? 'Source' : 'Target'} authentication failed: ${parsed.error || 'Unknown error'}`;
        }
        
        return {
            success: !isLogicalFailure,
            result: parsed,
            isLogicalFailure,
            error: failureMessage
        };
      } catch (e) {
        return {
            success: true,
            result: { text: lastMessageText, system_mode: mode },
            isLogicalFailure: false
        };
      }
    } else {
      return {
          success: false,
          result: { error: 'Agent produced no output', system_mode: mode },
          isLogicalFailure: true,
          error: "Agent produced no output."
      };
    }
  }
}
