import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMToolDefinition, LLMResponse, LLMToolCall } from './types.js';

function consolidateMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) return messages;
  const result: LLMMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n\n' + msg.content;
    } else {
      result.push({ ...msg });
    }
  }
  // Ensure first non-system message is 'user'
  if (result.length > 0 && result[0]!.role === 'assistant') {
    result.unshift({ role: 'user', content: '(continuing conversation)' });
  }
  return result;
}

export class ClaudeProvider implements LLMProvider {
  public readonly name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? 'claude-sonnet-4-20250514';
  }

  async chat(messages: LLMMessage[], options?: {
    tools?: LLMToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const systemText = systemMessages.map(m => m.content).join('\n\n');

    const consolidated = consolidateMessages(nonSystemMessages);

    const anthropicMessages: Anthropic.MessageParam[] = consolidated.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const tools: Anthropic.Tool[] | undefined = options?.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      ...(systemText ? { system: systemText } : {}),
      messages: anthropicMessages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    let content: string | null = null;
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content = (content ?? '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
