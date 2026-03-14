import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LLMProvider, LLMMessage, LLMToolDefinition } from '../llm/types.js';
import type { BrowserEngine } from '../browser/engine.js';
import type { McpBrowserEngine } from '../browser/mcp-engine.js';
import { ActionExecutor, getBrowserToolDefinitions } from '../browser/actions.js';
import { extractDOM } from '../browser/dom.js';
import { TaskPlanner } from './planner.js';
import type { AgentState, AgentStep, TaskPlan } from './types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { MemoryStore } from '../memory/store.js';
import type { AgentEventBus } from '../events.js';
import { logger } from '../utils/logger.js';

export interface AgentLoopOptions {
  llm: LLMProvider;
  browser: BrowserEngine;
  mcpEngine?: McpBrowserEngine;
  skillRegistry: SkillRegistry;
  memory: MemoryStore;
  eventBus?: AgentEventBus;
  maxSteps?: number;
  onStep?: (step: AgentStep) => void;
}

export class AgentLoop {
  private llm: LLMProvider;
  private browser: BrowserEngine;
  private mcpEngine?: McpBrowserEngine;
  private skillRegistry: SkillRegistry;
  private memory: MemoryStore;
  private eventBus?: AgentEventBus;
  private maxSteps: number;
  private onStep?: (step: AgentStep) => void;

  constructor(options: AgentLoopOptions) {
    this.llm = options.llm;
    this.browser = options.browser;
    this.mcpEngine = options.mcpEngine;
    this.skillRegistry = options.skillRegistry;
    this.memory = options.memory;
    this.eventBus = options.eventBus;
    this.maxSteps = options.maxSteps ?? 30;
    this.onStep = options.onStep;
  }

  async run(task: string): Promise<AgentState> {
    const state: AgentState = {
      task,
      status: 'running',
      history: [],
      result: null,
    };

    this.eventBus?.emit('task:start', { task });

    try {
      // Load context from memory
      const profile = await this.memory.getProfile();
      const documents = await this.memory.getDocuments();

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(profile, documents);

      // Get available tools
      const tools = await this.getAvailableTools();

      // Initialize messages
      const messages: LLMMessage[] = [
        { role: 'user', content: task },
      ];

      let stepCount = 0;

      while (stepCount < this.maxSteps) {
        stepCount++;
        logger.info(`Step ${stepCount}/${this.maxSteps}`);

        // Get LLM response
        const response = await this.llm.complete({
          system: systemPrompt,
          messages,
          tools,
        });

        if (response.type === 'text') {
          // Task completed
          state.status = 'completed';
          state.result = response.text;
          this.eventBus?.emit('task:complete', { result: response.text });
          break;
        }

        if (response.type === 'tool_calls') {
          const step: AgentStep = {
            reasoning: response.reasoning,
            actions: [],
          };

          // Process tool calls
          for (const toolCall of response.toolCalls) {
            logger.info(`Tool: ${toolCall.name}`);
            this.eventBus?.emit('tool:call', { name: toolCall.name, args: toolCall.args });

            let result: string;
            try {
              result = await this.executeToolCall(toolCall.name, toolCall.args);
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }

            logger.info(`Result: ${result.slice(0, 200)}`);
            this.eventBus?.emit('tool:result', { name: toolCall.name, result });

            step.actions.push({
              name: toolCall.name,
              args: toolCall.args,
              result,
            });

            // Add tool result to messages
            messages.push({
              role: 'tool',
              toolCallId: toolCall.id,
              content: result,
            });
          }

          state.history.push(step);
          this.onStep?.(step);

          // Add assistant message
          messages.push({
            role: 'assistant',
            toolCalls: response.toolCalls,
          });
        }
      }

      if (state.status === 'running') {
        state.status = 'failed';
        state.result = `Task exceeded maximum steps (${this.maxSteps})`;
        this.eventBus?.emit('task:fail', { reason: state.result });
      }
    } catch (err) {
      state.status = 'failed';
      state.result = err instanceof Error ? err.message : String(err);
      this.eventBus?.emit('task:fail', { reason: state.result });
    }

    return state;
  }

  private buildSystemPrompt(profile: Awaited<ReturnType<MemoryStore['getProfile']>>, documents: Awaited<ReturnType<MemoryStore['getDocuments']>>): string {
    const parts: string[] = [
      `You are brmonk, an AI-powered browser automation agent. Your goal is to complete the given task efficiently and accurately using the available browser tools.`,
      ``,
      `## Capabilities`,
      `- Navigate to URLs and interact with web pages`,
      `- Click, type, scroll, and interact with page elements`,
      `- Extract information and take screenshots`,
      `- Fill out forms and submit data`,
      `- Wait for page loads and dynamic content`,
    ];

    if (profile) {
      parts.push(``);
      parts.push(`## User Profile`);
      parts.push(`Name: ${profile.name}`);
      parts.push(`Email: ${profile.email}`);
      if (profile.phone) parts.push(`Phone: ${profile.phone}`);
      if (profile.location) parts.push(`Location: ${profile.location}`);
      if (profile.summary) parts.push(`Summary: ${profile.summary}`);

      if (profile.attributes && Object.keys(profile.attributes).length > 0) {
        parts.push(`Additional info:`);
        for (const [key, value] of Object.entries(profile.attributes)) {
          parts.push(`  ${key}: ${JSON.stringify(value)}`);
        }
      }
    }

    if (documents.length > 0) {
      parts.push(``);
      parts.push(`## Available Documents`);
      for (const doc of documents) {
        parts.push(`### ${doc.name} (${doc.type})`);
        parts.push(doc.content);
      }
    }

    const skills = this.skillRegistry.listSkills();
    const richSkills = this.skillRegistry.listRichSkills();

    if (skills.length > 0 || richSkills.length > 0) {
      parts.push(``);
      parts.push(`## Available Skills`);

      for (const skill of skills) {
        if (skill.systemPrompt) {
          parts.push(`### ${skill.name}`);
          parts.push(skill.systemPrompt);
        }
      }

      for (const skill of richSkills) {
        parts.push(`### ${skill.manifest.name}`);
        parts.push(skill.manifest.instructions);
      }
    }

    parts.push(``);
    parts.push(`## Guidelines`);
    parts.push(`- Always verify your actions were successful`);
    parts.push(`- Take screenshots to confirm important states`);
    parts.push(`- Use the most specific selector available`);
    parts.push(`- Handle errors gracefully and retry with different approaches`);
    parts.push(`- When a task is complete, provide a clear summary of what was accomplished`);

    return parts.join('\n');
  }

  private async getAvailableTools(): Promise<LLMToolDefinition[]> {
    const tools: LLMToolDefinition[] = [];

    // Check if we're using MCP engine for browser actions
    if (this.mcpEngine) {
      // Get MCP tools from the remote/local MCP server
      const mcpTools = await this.mcpEngine.listTools();
      tools.push(...mcpTools);
    } else {
      // Use built-in browser tools
      tools.push(...getBrowserToolDefinitions());
    }

    // Add skill tools
    const skillTools = this.skillRegistry.getToolDefinitions();
    tools.push(...skillTools);

    return tools;
  }

  private async executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
    // Check if it's an MCP tool
    if (this.mcpEngine) {
      const mcpTools = await this.mcpEngine.listTools();
      const isMcpTool = mcpTools.some(t => t.name === name);
      if (isMcpTool) {
        return await this.mcpEngine.executeTool(name, args);
      }
    }

    // Check skill tools first
    const skillTool = this.skillRegistry.findTool(name);
    if (skillTool) {
      return await skillTool.execute(args, {
        browser: this.browser,
        memory: this.memory,
      });
    }

    // Fall back to built-in browser actions
    const page = this.browser.currentPage();
    const executor = new ActionExecutor(page);
    return await executor.execute(name, args);
  }

  /** Convenience method: run task with screenshot context */
  async runWithContext(task: string, contextUrl?: string): Promise<AgentState> {
    if (contextUrl) {
      try {
        const page = this.browser.currentPage();
        await page.goto(contextUrl);
      } catch {
        // Ignore navigation errors
      }
    }
    return this.run(task);
  }

  /** Get current agent status */
  getStatus(): { maxSteps: number; llmProvider: string } {
    return {
      maxSteps: this.maxSteps,
      llmProvider: this.llm.name,
    };
  }

  /** Run task with a timeout */
  async runWithTimeout(task: string, timeoutMs: number): Promise<AgentState> {
    const timeoutPromise = new Promise<AgentState>((resolve) => {
      setTimeout(() => {
        resolve({
          task,
          status: 'failed',
          history: [],
          result: `Task timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });

    return Promise.race([this.run(task), timeoutPromise]);
  }

  /** Export session as markdown */
  exportSession(state: AgentState): string {
    const lines: string[] = [
      `# Session: ${state.task}`,
      `Status: ${state.status}`,
      `Result: ${state.result}`,
      ``,
      `## Steps`,
    ];

    for (let i = 0; i < state.history.length; i++) {
      const step = state.history[i];
      if (!step) continue;
      lines.push(``);
      lines.push(`### Step ${i + 1}`);
      if (step.reasoning) lines.push(`**Reasoning:** ${step.reasoning}`);
      for (const action of step.actions) {
        lines.push(`- **${action.name}**: ${JSON.stringify(action.args)}`);
        lines.push(`  Result: ${action.result}`);
      }
    }

    return lines.join('\n');
  }

  /** Generate a session summary using the LLM */
  async summarizeSession(state: AgentState): Promise<string> {
    const sessionText = this.exportSession(state);
    const response = await this.llm.complete({
      messages: [
        {
          role: 'user',
          content: `Please provide a brief summary of this browser automation session:\n\n${sessionText}`,
        },
      ],
    });

    if (response.type === 'text') {
      return response.text;
    }

    return state.result ?? 'No summary available';
  }

  /** Save a screenshot of the current page state */
  async saveScreenshot(outputDir?: string): Promise<string> {
    const dir = outputDir ?? os.tmpdir();
    const filename = `brmonk-${Date.now()}.png`;
    const filepath = path.join(dir, filename);
    const page = this.browser.currentPage();
    await page.screenshot({ path: filepath });
    return filepath;
  }
}
