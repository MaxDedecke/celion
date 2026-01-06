import { btoa } from 'buffer';
import { getAuthFlowConfig } from './assistant';
import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { createResponse } from '../openai/run';
import { extractMessageText, extractJson } from '../openai/message';
import { parseAuthFlowResponse } from './parser';
import { readSchemeFile } from '../../tools/readSchemeFile';
import { httpRequestTool } from '../openai/httpTool';
import type { HttpRequestParams } from '../../types/agents';
import type {
  OpenAiOutputItem,
  OpenAiResponse,
  OpenAiResponseMessage,
  OpenAiResponseToolCall,
} from '../openai/types';
import type { AuthFlowResult, AuthSchemeDefinition } from './types';

export type RunAuthFlowParams = {
  system: string;
  baseUrl: string;
  apiToken?: string;
  email?: string;
  password?: string;
};

// --- Tool Execution Logic ---

const executeToolCall = async (call: OpenAiResponseToolCall): Promise<{ tool_call_id: string; output: string }> => {
  const { id, function: fn } = call;

  if (fn.name === 'read_scheme') {
    let args: { system: string } = { system: '' };
    try {
      args = JSON.parse(fn.arguments ?? '{}');
    } catch {
      /* ignore parsing error */
    }
    try {
      const schemePath = `/schemes/${args.system}.json`;
      const scheme = await readSchemeFile<AuthSchemeDefinition>({ path: schemePath });
      return { tool_call_id: id, output: JSON.stringify(scheme) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Schema nicht gefunden';
      return {
        tool_call_id: id,
        output: JSON.stringify({ error: errorMessage }),
      };
    }
  }

  if (fn.name === 'construct_auth_header') {
    let args: {
      auth_type: string;
      email?: string;
      api_token?: string;
      additional_headers?: Record<string, string>;
    } = { auth_type: '' };
    try {
      args = JSON.parse(fn.arguments ?? '{}');
    } catch {
      /* ignore parsing error */
    }

    let constructedHeaders: Record<string, string> = {};
    if (args.auth_type === 'basic' && args.email && args.api_token) {
      const credentials = `${args.email}:${args.api_token}`;
      const base64Encoded = btoa(credentials);
      constructedHeaders['Authorization'] = `Basic ${base64Encoded}`;
    } else if (['bearer', 'bearer_token'].includes(args.auth_type) && args.api_token) {
      constructedHeaders['Authorization'] = `Bearer ${args.api_token}`;
    } else if (args.auth_type === 'api_key_header' && args.api_token) {
      constructedHeaders['X-Api-Key'] = args.api_token;
    }

    if (args.additional_headers) {
      for (const [key, value] of Object.entries(args.additional_headers)) {
        if (key.toLowerCase() === 'contenttype') constructedHeaders['Content-Type'] = value;
        else if (key.toLowerCase() === 'accept') constructedHeaders['Accept'] = value;
        else constructedHeaders[key] = value;
      }
    }
    return { tool_call_id: id, output: JSON.stringify(constructedHeaders) };
  }

  if (fn.name === 'http_request') {
    let args: HttpRequestParams & { body?: string } = { url: '', method: 'GET', headers: {} };
    try {
      args = JSON.parse(fn.arguments ?? '{}');
    } catch {
      /* ignore parsing error */
    }

    let bodyPayload: unknown = null;
    if (args.body && typeof args.body === 'string') {
      try {
        bodyPayload = JSON.parse(args.body);
      } catch {
        bodyPayload = args.body;
      }
    }

    const output = await httpRequestTool({
      url: args.url,
      method: args.method,
      headers: args.headers || {},
      body: bodyPayload,
    });
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  return { tool_call_id: id, output: JSON.stringify({ error: `Unknown tool: ${fn.name}` }) };
};

// --- Prompt & Main Logic ---

const normalizeSystemName = (systemName: string): string =>
  systemName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

const buildAuthFlowPrompt = (params: RunAuthFlowParams): string => {
  const normalizedSystem = normalizeSystemName(params.system);

  const credentialParts: string[] = [];
  if (params.email) credentialParts.push(`- Email: ${params.email}`);
  if (params.apiToken) credentialParts.push(`- API Token: ${params.apiToken}`);
  if (params.password) credentialParts.push(`- Password: ${params.password}`);

  return `Validiere die Authentifizierung für folgendes System:

System: ${params.system}
Normalisierter System-Name für Schema: ${normalizedSystem}
Base URL: ${params.baseUrl}

Credentials:
${credentialParts.join('\n')}

Schritte:
1. Lies das Schema mit read_scheme für "${normalizedSystem}"
2. Nutze construct_auth_header mit auth_type aus dem Schema, email und api_token aus den Credentials, und additional_headers aus schema.headers
3. Führe http_request aus mit den konstruierten Headers zum Probe-Endpoint
4. Gib das Ergebnis als JSON zurück

WICHTIG: Verwende IMMER construct_auth_header für die Header-Konstruktion!`;
};

export const runAuthFlow = async (params: RunAuthFlowParams): Promise<AuthFlowResult> => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const { instructions, tools } = getAuthFlowConfig();

  const prompt = buildAuthFlowPrompt(params);
  const initialInput = [
    { role: 'system', content: instructions },
    { role: 'user', content: prompt },
  ];

  let response = await createResponse(baseUrl, headers, {
    model: 'gpt-4.1-mini',
    input: initialInput,
    tools,
  });

  while (response.output.some(o => o.type === 'tool_call')) {
    const toolCalls = response.output.filter(
      (o): o is OpenAiResponseToolCall => o.type === 'tool_call',
    );

    const toolOutputs = await Promise.all(
      toolCalls.map(async call => {
        const output = await executeToolCall(call);
        return {
          type: 'function_call_output' as const,
          tool_call_id: output.tool_call_id,
          output: output.output,
        };
      }),
    );

    response = await createResponse(baseUrl, headers, {
      model: 'gpt-4.1-mini',
      input: toolOutputs,
    });
  }

  const message = response.output.find((o): o is OpenAiResponseMessage => o.type === 'message');

  if (message) {
    const rawText = extractMessageText({ ...message, id: '', role: 'assistant' });
    const jsonText = extractJson(rawText);
    const parsed = parseAuthFlowResponse(jsonText);

    return {
      ...parsed,
      system: parsed.system ?? params.system,
      base_url: parsed.base_url ?? params.baseUrl,
      authenticated: parsed.valid,
      auth_method: parsed.authType,
      auth_headers: parsed.normalizedHeaders,
      raw_output: rawText,
    };
  }

  throw new Error('Auth Flow returned no message.');
};