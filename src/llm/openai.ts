import OpenAI from 'openai';
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMResponse, LLMToolCall } from './types.js';

export class OpenAIProvider implements LLMProvider {
  public readonly name: string;
  protected client: OpenAI;
  protected model: string;

  constructor(apiKey: string, model?: string, baseURL?: string, providerName?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model ?? 'gpt-4o';
    this.name = providerName ?? 'openai';
  }

  async chat(messages: LLMMessage[], options?: {
    tools?: LLMToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(m => {
      if (m.role === 'system') {
        return { role: 'system' as const, content: m.content };
      } else if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: m.content };
      } else {
        return { role: 'user' as const, content: m.content };
      }
    });

    const tools: OpenAI.ChatCompletionTool[] | undefined = options?.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const content = message?.content ?? null;
    const toolCalls: LLMToolCall[] = [];

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          toolCalls.push({ name: tc.function.name, arguments: args });
        }
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
