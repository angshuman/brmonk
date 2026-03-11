import { OpenAIProvider } from './openai.js';

export class GrokProvider extends OpenAIProvider {
  constructor(apiKey: string, model?: string) {
    super(apiKey, model ?? 'grok-3', 'https://api.x.ai/v1', 'grok');
  }
}
