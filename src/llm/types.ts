export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options?: {
    tools?: LLMToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse>;
}
