import { AgentBase } from '../core/AgentBase';
import { Tool, ChatMessage } from '../core/LlmProvider';
import { curlHeadProbe } from '../../tools/curlHeadProbe';
import { httpClient } from '../../tools/httpRequest';

export class SystemDetectionAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber } = this.context;
    const url = params?.url;
    const expected = params?.expectedSystem;
    const instructions = params?.instructions;
    const mode = params?.mode || 'source';

    const headerMsg = mode === 'source' ? "Analysiere **Quellsystem**" : "Analysiere **Zielsystem**";
    await this.context.writeChatMessage('assistant', headerMsg, stepNumber);
    const detailMsg = `Ich überprüfe, ob **${expected}** zu der URL **${url}** passt.`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    const SYSTEM_PROMPT = `
Identify the software system at the target URL.
Check HTTP headers, HTML content, and API endpoints.
Use 'curl_head_probe' first for headers. Use 'http_probe' for HTML/API checks if needed.
Compare with 'Expected System'.

Return JSON:
{
  "systemMatchesUrl": boolean,
  "summary": string, // A human-readable summary of the detection (e.g. "Verbindung zum System erfolgreich")
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

    const TOOLS: Tool[] = [
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

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `URL: ${url}
Expected: ${expected || '?'}
Hints: ${instructions || '-'}` }
    ];

    let lastMessageText: string | undefined;

    for (let turn = 0; turn < 15; turn++) {
      const response = await this.provider.chat(messages, TOOLS, { 
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          response_format: { type: "json_object" } 
      });
      
      const message: ChatMessage = {
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls
      };
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
            if (functionName === 'curl_head_probe') {
              result = await curlHeadProbe(args);
            } else if (functionName === 'http_probe') {
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
        
        if (parsed.systemMatchesUrl === false) {
           isLogicalFailure = true;
           failureMessage = `${mode === 'source' ? 'Source' : 'Target'} system detection failed: URL does not match expected system.`;
        }
        
        return {
            success: !isLogicalFailure,
            result: parsed,
            isLogicalFailure,
            error: failureMessage
        };
      } catch (e) {
        return {
            success: true, // We have text, but not JSON
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
