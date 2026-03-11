import type { LLMToolDefinition } from '../llm/types.js';
import type { AgentLoop } from '../agent/loop.js';
import type { BrowserEngine } from '../browser/engine.js';
import type { LLMProvider } from '../llm/types.js';
import type { MemoryStore } from '../memory/store.js';

export interface SkillContext {
  agent: AgentLoop;
  browser: BrowserEngine;
  llm: LLMProvider;
  memory: MemoryStore;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  systemPrompt: string;
  tools: LLMToolDefinition[];
  execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string>;
}
