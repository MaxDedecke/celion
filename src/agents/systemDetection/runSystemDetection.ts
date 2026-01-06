// src/agents/systemDetection/runSystemDetection.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { buildSystemDetectionPrompt } from './prompt';
import { createResponse } from '../openai/run';
import { extractMessageText, extractJson } from '../openai/message';
import { parseSystemDetectionResponse, SystemDetectionResult } from './parser';
import { curlHeadProbeTool } from '../openai/curlHeadTool';
import { httpRequestTool } from '../openai/httpTool';
import { getSystemDetectionConfig } from './assistant';
import type {
  CurlHeadProbeParams,
  HttpRequestParams,
  CurlHeadProbeResponse,
} from '../../types/agents';
import type {
  OpenAiResponse,
  OpenAiResponseToolCall,
  OpenAiResponseMessage,
} from '../openai/types';

// --- Tool Execution ---

const executeToolCall = async (call: OpenAiResponseToolCall): Promise<{ tool_call_id: string; output: string }> => {
  const { id, function: fn } = call;

  if (fn.name === 'curl_head_probe') {
    let args: CurlHeadProbeParams = { url: '' } as CurlHeadProbeParams;
    try {
      args = JSON.parse(fn.arguments ?? '{}') as CurlHeadProbeParams;
    } catch { /* ignore */ }
    const output = (await curlHeadProbeTool(args)) as CurlHeadProbeResponse;
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  if (fn.name === 'http_probe') {
    let args: HttpRequestParams = { url: '', method: 'GET' };
    try {
      args = JSON.parse(fn.arguments ?? '{}') as HttpRequestParams;
    } catch { /* ignore */ }
    const output = await httpRequestTool(args);
    return { tool_call_id: id, output: JSON.stringify(output) };
  }

  return { tool_call_id: id, output: JSON.stringify({ error: `Unknown tool: ${fn.name}` }) };
};

// --- Main Logic ---

export const runSystemDetection = async (
  url: string,
  expectedSystem?: string,
): Promise<SystemDetectionResult> => {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const { instructions, tools } = getSystemDetectionConfig(expectedSystem);
  const prompt = buildSystemDetectionPrompt(url, expectedSystem);

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
    return parseSystemDetectionResponse(jsonText);
  }

  throw new Error('System Detection returned no message.');
};