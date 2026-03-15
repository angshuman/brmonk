import type { LLMProvider } from './types.js';
import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GrokProvider } from './grok.js';

export type ProviderName = 'claude' | 'openai' | 'grok' | 'auto';

/** Check if an API key looks like a real key (not empty, not a placeholder) */
function isValidKey(key: string | undefined): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 8) return false;
  // Skip common placeholder patterns from .env.example or templates
  if (/^(sk-ant-\.\.\.|sk-\.\.\.|xai-\.\.\.|your[-_]|xxx|placeholder)/i.test(trimmed)) return false;
  return true;
}

export function createProvider(provider: ProviderName = 'auto', model?: string): LLMProvider {
  if (provider === 'claude' || (provider === 'auto' && isValidKey(process.env['ANTHROPIC_API_KEY']))) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!isValidKey(apiKey)) throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude provider');
    return new ClaudeProvider(apiKey, model);
  }

  if (provider === 'openai' || (provider === 'auto' && isValidKey(process.env['OPENAI_API_KEY']))) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!isValidKey(apiKey)) throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
    return new OpenAIProvider(apiKey, model);
  }

  if (provider === 'grok' || (provider === 'auto' && isValidKey(process.env['XAI_API_KEY']))) {
    const apiKey = process.env['XAI_API_KEY'];
    if (!isValidKey(apiKey)) throw new Error('XAI_API_KEY environment variable is required for Grok provider');
    return new GrokProvider(apiKey, model);
  }

  throw new Error(
    'No LLM provider configured. Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY'
  );
}
