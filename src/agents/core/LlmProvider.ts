export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], tools?: Tool[], options?: any): Promise<any>;
}
