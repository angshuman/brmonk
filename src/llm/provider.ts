import type { LLMProvider } from './types.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GrokProvider } from './grok.js';

export type ProviderName = 'claude' | 'openai' | 'grok' | 'auto';

export function createProvider(provider: ProviderName = 'auto', model?: string): LLMProvider {
  if (provider === 'claude' || (provider === 'auto' && process.env['ANTHROPIC_API_KEY'])) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude provider');
    return new ClaudeProvider(apiKey, model);
  }

  if (provider === 'openai' || (provider === 'auto' && process.env['OPENAI_API_KEY'])) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
    return new OpenAIProvider(apiKey, model);
  }

  if (provider === 'grok' || (provider === 'auto' && process.env['GROK_API_KEY'])) {
    const apiKey = process.env['GROK_API_KEY'];
    if (!apiKey) throw new Error('GROK_API_KEY environment variable is required for Grok provider');
    return new GrokProvider(apiKey, model);
  }

  throw new Error(
    'No LLM provider configured. Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROK_API_KEY'
  );
}
