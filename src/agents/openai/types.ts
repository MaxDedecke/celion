// src/agents/openai/types.ts

export interface Conversation {
  id: string;
}

export interface Message {
  type: 'message';
  id?: string;
  role: string;
  content: Array<{
    type: 'output_text';
    text: string;
  }>;
}

export interface ToolCall {
  type: 'tool_call';
  tool_call: {
    id: string;
    tool_name: string;
    parameters: any;
  };
}

export interface OpenAiResponse {
  output: (Message | ToolCall)[];
}
