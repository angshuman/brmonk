import { loadConfig, type Config } from './config.js';
import { createProvider, type ProviderName } from './llm/provider.js';
import { BrowserEngine } from './browser/engine.js';
import { AgentLoop } from './agent/loop.js';
import { SkillRegistry } from './skills/registry.js';
import { MemoryStore } from './memory/store.js';
import { AgentEventBus } from './events.js';
import type { AgentState } from './agent/types.js';

export interface BrmonkOptions {
  provider?: ProviderName;
  model?: string;
  headless?: boolean;
  maxSteps?: number;
  memoryDir?: string;
  skillsDir?: string;
  verbose?: boolean;
}

export class Brmonk {
  private config: Config | null = null;
  private browser: BrowserEngine | null = null;
  private agent: AgentLoop | null = null;
  private memory: MemoryStore | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private eventBus: AgentEventBus;
  private options: BrmonkOptions;
  private initialized = false;

  constructor(options?: BrmonkOptions) {
    this.options = options ?? {};
    this.eventBus = new AgentEventBus();
  }

  getEventBus(): AgentEventBus {
    return this.eventBus;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;

    this.config = await loadConfig({
      provider: this.options.provider,
      model: this.options.model ?? '',
      headless: this.options.headless,
      maxSteps: this.options.maxSteps,
      verbose: this.options.verbose,
    });

    const llm = createProvider(this.config.provider, this.config.model || undefined);
    this.browser = new BrowserEngine(this.config.headless, this.config.persistBrowserContext);
    this.skillRegistry = new SkillRegistry();
    this.memory = new MemoryStore(this.config.memoryDir);

    await this.skillRegistry.loadFromDirectory(this.config.skillsDir);
    await this.browser.launch();

    this.agent = new AgentLoop({
      llm,
      browser: this.browser,
      skillRegistry: this.skillRegistry,
      memory: this.memory,
      eventBus: this.eventBus,
      maxSteps: this.config.maxSteps,
    });

    this.initialized = true;
  }

  async run(task: string): Promise<string> {
    await this.init();

    const state = await this.agent!.run(task);

    // Save session
    if (this.memory) {
      const sessionId = `api-${Date.now()}`;
      await this.memory.saveSession(sessionId, state.history, task);
    }

    if (state.status === 'completed') {
      return state.result ?? 'Task completed';
    }

    throw new Error(state.result ?? 'Task failed');
  }

  async getState(): Promise<AgentState | null> {
    if (!this.agent) return null;
    return this.agent.getState();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.initialized = false;
    this.agent = null;
  }
}

// Re-export types and utilities
export type { Config } from './config.js';
export type { LLMProvider, LLMMessage, LLMToolDefinition, LLMToolCall, LLMResponse } from './llm/types.js';
export type { AgentState, AgentStep, TaskPlan, PlanStep } from './agent/types.js';
export type { Skill, SkillContext } from './skills/types.js';
export type { AgentEvent } from './events.js';
export type {
  UserProfile, TrackedItem, TrackedItemFilter, TrackedItemMatch,
  UserDocument, MemoryEntry,
  SessionRecord, MemoryFact, CachedResult, SessionSummary,
} from './memory/types.js';
export { BrowserEngine } from './browser/engine.js';
export { AgentLoop } from './agent/loop.js';
export { SkillRegistry } from './skills/registry.js';
export { MemoryStore } from './memory/store.js';
export { AgentEventBus } from './events.js';
export { createProvider } from './llm/provider.js';
export { loadConfig } from './config.js';
export { logger } from './utils/logger.js';
