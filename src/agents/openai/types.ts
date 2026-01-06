// src/agents/openai/types.ts

export type OpenAiAssistant = {
  id: string;
};

export type OpenAiRun = {
  id: string;
  status: string;
  last_error?: { message?: string } | null;
  required_action?: {
    type?: string;
    submit_tool_outputs?: {
      tool_calls: Array<{
        id: string;
        type: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  } | null;
};

export type OpenAiMessageContent = {
  type: string;
  text?: { value?: string } | string;
  input_text?: string;
};

export type OpenAiMessage = {
  id: string;
  role: string;
  content: OpenAiMessageContent[];
};

export interface OpenAiResponse {
  output: OpenAiOutputItem[];
}

export type OpenAiOutputItem = OpenAiResponseMessage | OpenAiResponseToolCall;

export interface OpenAiResponseMessage {
  type: 'message';
  content: OpenAiMessageContent[];
  role: 'assistant';
}

export interface OpenAiResponseToolCall {
  type: 'tool_call';
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}
