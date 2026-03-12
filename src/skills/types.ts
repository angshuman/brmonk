import type { LLMToolDefinition } from '../llm/types.js';
import type { AgentLoop } from '../agent/loop.js';
import type { BrowserEngine } from '../browser/engine.js';
import type { LLMProvider } from '../llm/types.js';
import type { MemoryStore } from '../memory/store.js';

// --- Existing built-in skill types (unchanged) ---

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

// --- Rich skill types (new) ---

export interface RichSkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  instructions: string;
  tools: LLMToolDefinition[];
  actions: Record<string, SkillAction>;
  env?: {
    required?: string[];
    optional?: string[];
  };
}

export interface SkillAction {
  steps: ActionStep[];
}

export type ActionStep =
  | ShellStep
  | ScriptStep
  | BrowserStep
  | LLMStep
  | ConditionalStep;

export interface ShellStep {
  type: 'shell';
  command: string;
  cwd?: string;
  timeout?: number;
  captureOutput?: boolean;
  env?: Record<string, string>;
}

export interface ScriptStep {
  type: 'script';
  file: string;
  runtime?: 'python' | 'node' | 'bash';
  args?: string[];
  timeout?: number;
  captureOutput?: boolean;
  env?: Record<string, string>;
}

export interface BrowserStep {
  type: 'browser';
  actions: Array<Record<string, unknown>>;
  captureOutput?: boolean;
}

export interface LLMStep {
  type: 'llm';
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  captureOutput?: boolean;
}

export interface ConditionalStep {
  type: 'conditional';
  condition: string;
  then: ActionStep[];
  else?: ActionStep[];
  captureOutput?: boolean;
}

export interface RichSkill {
  kind: 'rich';
  manifest: RichSkillManifest;
  skillDir: string;
}

export type AnySkill = (Skill & { kind?: 'builtin' }) | RichSkill;
