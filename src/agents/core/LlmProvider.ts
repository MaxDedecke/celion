export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: any; // For debugging, but agents should not rely on this
}

export interface LlmProvider {
  chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<ChatResponse>;
}
