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
import type { Skill, SkillContext } from '../skills/types.js';
import { SkillExecutor } from '../skills/executor.js';
import type { MemoryStore } from '../memory/store.js';
import type { SessionResult } from '../memory/types.js';
import type { AgentEventBus } from '../events.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are brmonk, an AI browser automation agent. You control a web browser to accomplish tasks for the user.

## How You See the Page
You receive a snapshot of the current page showing:
- Page title and URL
- Page structure with headings hierarchy
- Interactive elements labeled with [index] numbers (e.g., [1] <button> "Submit")
- Form structures with required field markers
- A text summary of visible page content

## How to Interact
Use the provided tools to interact with the page:
- **click(index)**: Click an element by its [index] number
- **type(index, text)**: Type text into an input field
- **selectOption(index, value)**: Pick an option from a dropdown
- **hover(index)**: Hover over an element
- **scroll(direction, amount)**: Scroll up or down
- **goTo(url)**: Navigate to a URL
- **goBack()**: Go to previous page
- **waitForLoad()**: Wait for page to finish loading
- **screenshot()**: Take a screenshot
- **getPageContent()**: Get full page text content
- **evaluate(script)**: Run JavaScript in the page
- **newTab(url)**: Open a new tab
- **switchTab(index)**: Switch between tabs
- **dismissPopups()**: Dismiss cookie banners, modals, and overlays
- **waitForUser(message)**: Pause and ask the user to do something manually
- **extractText(selector?)**: Extract text from a specific page area
- **fillFormField(label, value)**: Fill a form field by its label text
- **clickByText(text)**: Click an element by its visible text
- **scrollToElement(index)**: Scroll an element into view
- **waitForElement(text, timeout?)**: Wait for an element with specific text to appear

## Strategy
1. First observe the page carefully - read all elements before acting
2. Plan your approach step by step
3. Execute one action at a time and observe the result
4. If an action fails, try an alternative approach
5. For forms: identify all fields first, fill them out, then submit
6. For navigation: look for links/buttons, click them, wait for page load
7. For data extraction: read page content carefully, use evaluate() for complex extraction
8. If you encounter popups or cookie banners, use dismissPopups() to clear them
9. If you encounter a CAPTCHA, use waitForUser() to ask the user to solve it
10. If a login is required, use waitForUser() to ask the user to log in

## Completion
- Use **done(result)** when you have accomplished the task. Include any relevant data/results.
- Use **fail(reason)** when the task genuinely cannot be completed after reasonable attempts.
- Always prefer done() over fail() - be persistent and creative in finding solutions.`;

const TOKEN_LIMIT = 30000;

function estimateTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += Math.ceil(m.content.length / 4);
  }
  return total;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

export class AgentLoop {
  private llm: LLMProvider;
  private browser: BrowserEngine;
  private mcpEngine: McpBrowserEngine | null;
  private actionExecutor: ActionExecutor;
  private planner: TaskPlanner;
  private skillRegistry: SkillRegistry | null;
  private skillExecutor: SkillExecutor | null;
  private memory: MemoryStore | null;
  private eventBus: AgentEventBus | null;
  private state: AgentState;
  private messages: LLMMessage[] = [];
  private paused = false;
  private pauseResolver: (() => void) | null = null;
  private lastObservationHash = '';
  private pendingMessages: string[] = [];
  private lastCaptchaCheckTime = 0;
  private lastCaptchaCheckUrl = '';
  private startedAt = '';
  private toolsUsedSet = new Set<string>();
  private urlsVisited = new Set<string>();
  private lastScreenshotTime = 0;
  private screenshotInterval = 2000; // minimum ms between screenshots

  constructor(options: {
    llm: LLMProvider;
    browser: BrowserEngine;
    mcpEngine?: McpBrowserEngine;
    skillRegistry?: SkillRegistry;
    memory?: MemoryStore;
    eventBus?: AgentEventBus;
    maxSteps?: number;
  }) {
    this.llm = options.llm;
    this.browser = options.browser;
    this.mcpEngine = options.mcpEngine ?? null;
    this.actionExecutor = new ActionExecutor(options.browser);
    this.planner = new TaskPlanner(options.llm);
    this.skillRegistry = options.skillRegistry ?? null;
    this.skillExecutor = options.skillRegistry
      ? new SkillExecutor(options.browser, options.llm, this.actionExecutor)
      : null;
    this.memory = options.memory ?? null;
    this.eventBus = options.eventBus ?? null;
    this.state = {
      taskDescription: '',
      currentUrl: '',
      pageTitle: '',
      domSnapshot: '',
      history: [],
      stepCount: 0,
      maxSteps: options.maxSteps ?? 50,
      status: 'running',
      result: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };

    if (this.eventBus) {
      this.browser.setEventBus(this.eventBus);
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }

  pause(): void {
    this.paused = true;
    this.state.status = 'paused';
    this.eventBus?.emitStatus('paused');
  }

  resume(): void {
    this.paused = false;
    if (this.state.status === 'paused') {
      this.state.status = 'running';
    }
    if (this.pauseResolver) {
      this.pauseResolver();
      this.pauseResolver = null;
    }
    this.eventBus?.emitStatus('running');
  }

  injectMessage(message: string): void {
    this.pendingMessages.push(message);
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.paused) return;
    return new Promise<void>((resolve) => {
      this.pauseResolver = resolve;
    });
  }

  private summarizeHistory(messages: LLMMessage[]): string {
    const actions: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && msg.content.startsWith('Tool Results:')) {
        const lines = msg.content.split('\n').filter(l => l.startsWith('- '));
        for (const line of lines) {
          actions.push(line.slice(2).slice(0, 100));
        }
      } else if (msg.role === 'assistant' && msg.content) {
        const short = msg.content.slice(0, 80);
        actions.push(`Thought: ${short}`);
      }
    }
    if (actions.length === 0) return 'No significant actions taken yet.';
    return `Summary of previous actions:\n${actions.slice(-15).join('\n')}`;
  }

  private manageContext(): void {
    const tokens = estimateTokens(this.messages);
    if (tokens <= TOKEN_LIMIT) return;

    const system = this.messages[0];
    const taskMsg = this.messages[1];
    if (!system || !taskMsg) return;

    const recent = this.messages.slice(-10);
    const older = this.messages.slice(2, -10);
    const summary = this.summarizeHistory(older);

    this.messages = [
      system,
      taskMsg,
      { role: 'user', content: summary },
      ...recent,
    ];
  }

  async run(task: string): Promise<AgentState> {
    this.state.taskDescription = task;
    this.state.status = 'running';
    this.state.result = null;
    this.state.history = [];
    this.state.stepCount = 0;
    this.state.totalInputTokens = 0;
    this.state.totalOutputTokens = 0;
    this.paused = false;
    this.lastObservationHash = '';
    this.pendingMessages = [];
    this.actionExecutor.resetStatus();
    this.startedAt = new Date().toISOString();
    this.toolsUsedSet.clear();
    this.urlsVisited.clear();

    logger.thought(`Starting task: ${task}`);
    this.eventBus?.emitStatus('running');

    // Create a plan
    let plan: TaskPlan;
    try {
      plan = await this.planner.createPlan(task);
      this.eventBus?.emitPlan(plan.steps.map(s => s.description));
    } catch {
      plan = { goal: task, steps: [{ description: task, checkpoint: 'Done' }] };
      this.eventBus?.emitPlan([task]);
    }

    // Build system prompt with skill extensions
    let systemPrompt = SYSTEM_PROMPT;
    if (plan.steps.length > 0) {
      systemPrompt += `\n\n## Current Plan\nGoal: ${plan.goal}\n`;
      plan.steps.forEach((step, i) => {
        systemPrompt += `${i + 1}. ${step.description} (checkpoint: ${step.checkpoint})\n`;
      });
    }

    // Add user profile context from memory
    if (this.memory) {
      try {
        const profile = await this.memory.getProfile();
        if (profile && profile.name) {
          systemPrompt += '\n\n## User Context\n';
          systemPrompt += `Name: ${profile.name}\n`;
          if (profile.email) systemPrompt += `Email: ${profile.email}\n`;
          if (profile.location) systemPrompt += `Location: ${profile.location}\n`;
          if (profile.summary) systemPrompt += `Summary: ${profile.summary}\n`;
          if (profile.attributes && Object.keys(profile.attributes).length > 0) {
            for (const [key, value] of Object.entries(profile.attributes)) {
              systemPrompt += `${key}: ${JSON.stringify(value)}\n`;
            }
          }
        }
      } catch {
        // No profile available
      }

      // Add lightweight index of available data (not full content)
      // The agent uses searchProfile tool to find relevant details on demand
      try {
        const documents = await this.memory.getDocuments();
        const items = await this.memory.getItems();
        const collections = await this.memory.getCollections();
        const factCategories = ['general', 'preferences', 'context'];
        let factCount = 0;
        for (const cat of factCategories) {
          const facts = await this.memory.getByCategory(cat);
          factCount += facts.length;
        }

        if (documents.length > 0 || items.length > 0 || factCount > 0) {
          systemPrompt += '\n\n## Available User Data\n';
          systemPrompt += 'Use the searchProfile tool to find relevant information before answering questions about the user.\n';
          if (documents.length > 0) {
            systemPrompt += `\nDocuments (${documents.length}):\n`;
            for (const doc of documents) {
              systemPrompt += `- ${doc.name} (${doc.type})\n`;
            }
          }
          if (items.length > 0) {
            systemPrompt += `\nTracked Items: ${items.length} across ${collections.length} collection(s): ${collections.join(', ')}\n`;
          }
          if (factCount > 0) {
            systemPrompt += `\nRemembered Facts: ${factCount}\n`;
          }
        }
      } catch {
        // No data
      }
    }

    // Add skill system prompts and tools (built-in + rich)
    const skillTools: LLMToolDefinition[] = [];
    if (this.skillRegistry) {
      // Built-in skills
      for (const skill of this.skillRegistry.listSkills()) {
        if (skill.systemPrompt) {
          systemPrompt += `\n\n## Skill: ${skill.name}\n${skill.systemPrompt}`;
        }
        skillTools.push(...skill.tools);
      }

      // Rich YAML-based skills
      for (const richSkill of this.skillRegistry.listRichSkills()) {
        systemPrompt += `\n\n## Skill: ${richSkill.manifest.name}\n${richSkill.manifest.instructions}`;
        skillTools.push(...richSkill.manifest.tools);
      }
    }

    this.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Task: ${task}` },
    ];

    // Build tools list — use MCP tools when available, otherwise built-in browser tools
    let browserTools: LLMToolDefinition[];
    if (this.mcpEngine) {
      // MCP mode: use MCP tools + done/fail from built-in tools
      const builtinTools = getBrowserToolDefinitions();
      const controlTools = builtinTools.filter(t => t.name === 'done' || t.name === 'fail');
      browserTools = [...this.mcpEngine.getTools(), ...controlTools];
    } else {
      browserTools = getBrowserToolDefinitions();
    }
    const memoryTools: LLMToolDefinition[] = [];
    if (this.memory) {
      memoryTools.push(
        {
          name: 'rememberFact',
          description: 'Store a fact about the user or task for future reference. Use this to remember preferences, important details, or anything the user tells you to remember.',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Short key describing the fact (e.g., "preferred_language", "company_name")' },
              value: { type: 'string', description: 'The fact to remember' },
              category: { type: 'string', description: 'Category: general, preferences, context' },
            },
            required: ['key', 'value'],
          },
        },
        {
          name: 'recallFact',
          description: 'Recall a previously stored fact by key',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'The fact key to recall' },
            },
            required: ['key'],
          },
        },
        {
          name: 'searchMemory',
          description: 'Search through stored facts and memory',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
        {
          name: 'searchProfile',
          description: 'Search across all user data — profile, documents, tracked items, and memory facts. Returns only content matching the query. Use this to answer questions about the user, find relevant information from imported documents, or look up tracked items.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query — keywords or phrases to find in user data' },
            },
            required: ['query'],
          },
        },
      );
    }
    const allTools = [...browserTools, ...skillTools, ...memoryTools];

    // Main agent loop
    while (this.state.stepCount < this.state.maxSteps && this.state.status === 'running') {
      await this.waitIfPaused();
      if (this.state.status !== 'running') break;

      this.state.stepCount++;
      logger.thought(`Step ${this.state.stepCount}/${this.state.maxSteps}`);
      this.eventBus?.emitStep(this.state.stepCount, this.state.maxSteps);

      // Pre-step: auto-dismiss popups (only after navigation, skip in MCP mode)
      if (!this.mcpEngine && this.browser.shouldDismissPopups()) {
        try {
          const dismissed = await this.browser.dismissPopups();
          for (const d of dismissed) {
            this.eventBus?.emitPopupDismissed(d);
          }
        } catch {
          // Page may not be loaded yet
        }
      }

      // Pre-step: detect CAPTCHA with cooldown — skip in MCP mode (MCP server manages browser)
      if (!this.mcpEngine) try {
        const currentUrl = this.browser.getCurrentDomain();
        const now = Date.now();
        const urlChanged = currentUrl !== this.lastCaptchaCheckUrl;
        const cooldownExpired = (now - this.lastCaptchaCheckTime) > 10000;
        if (urlChanged || cooldownExpired) {
          this.lastCaptchaCheckTime = now;
          this.lastCaptchaCheckUrl = currentUrl;
          const captchaResult = await this.browser.detectCaptcha();
          if (captchaResult.detected) {
            const captchaType = captchaResult.type;
            logger.thought(`CAPTCHA detected (${captchaType}) — handling...`);
            this.eventBus?.emitThought(`CAPTCHA detected: ${captchaType}`);

            if (captchaType === 'recaptcha-v2-checkbox') {
              // Checkbox — try clicking it
              const solved = await this.browser.attemptCaptchaSolve();
              if (solved) {
                logger.thought('CAPTCHA checkbox solved automatically');
                this.eventBus?.emitThought('CAPTCHA solved automatically');
              } else {
                logger.thought('CAPTCHA checkbox click failed — asking user');
                this.state.status = 'waiting-for-user';
                this.eventBus?.emitUserActionRequired('CAPTCHA detected. Please solve the CAPTCHA in the browser window.', 'captcha');
                await this.browser.waitForUserAction('Please solve the CAPTCHA in the browser window, then press Enter to continue.');
                this.state.status = 'running';
                this.eventBus?.emitStatus('running');
              }
            } else if (captchaType === 'cloudflare-turnstile') {
              // Turnstile often auto-solves — wait a few seconds first
              logger.thought('Cloudflare Turnstile detected — waiting for auto-solve...');
              this.eventBus?.emitThought('Waiting for Turnstile to auto-solve...');
              await new Promise(r => setTimeout(r, 5000));
              const recheck = await this.browser.detectCaptcha();
              if (recheck.detected) {
                this.state.status = 'waiting-for-user';
                this.eventBus?.emitUserActionRequired('Cloudflare Turnstile still present. Please complete it in the browser.', 'captcha');
                await this.browser.waitForUserAction('Please complete the Cloudflare challenge, then press Enter to continue.');
                this.state.status = 'running';
                this.eventBus?.emitStatus('running');
              } else {
                logger.thought('Turnstile resolved automatically');
                this.eventBus?.emitThought('Turnstile resolved automatically');
              }
            } else {
              // Challenge frames (recaptcha-v2-challenge, hcaptcha, generic-captcha) — can't auto-solve
              logger.thought('CAPTCHA challenge requires manual solving');
              this.state.status = 'waiting-for-user';
              this.eventBus?.emitUserActionRequired(`CAPTCHA (${captchaType}) detected. Please solve it in the browser window.`, 'captcha');
              await this.browser.waitForUserAction('Please solve the CAPTCHA in the browser window, then press Enter to continue.');
              this.state.status = 'running';
              this.eventBus?.emitStatus('running');
            }
          }
        }
      } catch {
        // Detection failed, continue
      }

      // Pre-step: detect login page — skip in MCP mode
      if (!this.mcpEngine) try {
        const domain = this.browser.getCurrentDomain();
        if (domain && !this.browser.isAuthenticated(domain)) {
          const isLogin = await this.browser.detectLoginPage();
          if (isLogin) {
            logger.thought(`Login page detected on ${domain} — waiting for user`);
            this.state.status = 'waiting-for-user';
            this.eventBus?.emitUserActionRequired(`Login required on ${domain}. Please log in via the browser window.`, 'login');
            await this.browser.waitForUserAction(`Please log in to ${domain} in the browser window, then press Enter to continue.`);
            this.browser.markAuthenticated(domain);
            if (this.memory) {
              await this.memory.markSiteAuthenticated(domain);
            }
            this.state.status = 'running';
            this.eventBus?.emitStatus('running');
          }
        }
      } catch {
        // Detection failed, continue
      }

      // Inject pending user messages
      if (this.pendingMessages.length > 0) {
        const injected = this.pendingMessages.splice(0);
        for (const msg of injected) {
          this.messages.push({ role: 'user', content: `User message: ${msg}` });
        }
      }

      // OBSERVE: Extract DOM state (skip in MCP mode — MCP tools return their own observations)
      let observation: string;
      if (this.mcpEngine) {
        observation = 'Browser is managed by MCP server. Use the browser_* tools to interact with the page.';
      } else {
        try {
          const page = this.browser.currentPage();
          const dom = await extractDOM(page);
          this.actionExecutor.updateElementMap(dom.elementMap);
          this.state.currentUrl = dom.url;
          this.state.pageTitle = dom.title;
          this.state.domSnapshot = dom.textRepresentation;
          if (dom.url) this.urlsVisited.add(dom.url);

          // Check if observation changed from last step
          const obsHash = simpleHash(dom.textRepresentation);
          if (obsHash === this.lastObservationHash) {
            observation = 'Page unchanged from previous observation.';
          } else {
            observation = dom.textRepresentation;
            this.lastObservationHash = obsHash;
          }
        } catch {
          observation = 'No page loaded yet. Use goTo(url) to navigate to a website.';
        }
      }

      // Capture screenshot after observing page state (skip in MCP mode — no direct browser access)
      if (!this.mcpEngine) {
        await this.captureScreenshot();
      }

      // Add observation to messages
      this.messages.push({
        role: 'user',
        content: `Current page state:\n${observation}`,
      });

      // Manage context window
      this.manageContext();

      // REASON: Send to LLM with retry
      logger.thought('Thinking...');
      this.eventBus?.emitThought('Analyzing page and deciding next action...');
      let response;
      try {
        response = await withRetry(
          () => this.llm.chat(this.messages, {
            tools: allTools,
            maxTokens: 4096,
            temperature: 0.2,
          }),
          { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 },
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`LLM error: ${errMsg}`);
        this.eventBus?.emitError(errMsg);
        this.state.status = 'failed';
        this.state.result = `LLM error: ${errMsg}`;
        break;
      }

      // Track token usage
      this.state.totalInputTokens += response.usage.inputTokens;
      this.state.totalOutputTokens += response.usage.outputTokens;

      const reasoning = response.content ?? '';
      if (reasoning) {
        logger.thought(reasoning);
        this.eventBus?.emitThought(reasoning);
        this.messages.push({ role: 'assistant', content: reasoning });
      }

      // ACT: Execute tool calls
      const step: AgentStep = {
        observation,
        reasoning,
        actions: [],
      };

      if (response.toolCalls.length === 0) {
        this.messages.push({
          role: 'user',
          content: 'Please use a tool to take action. Use done(result) if the task is complete, or use browser tools to interact with the page.',
        });
      }

      // Collect all tool results into a single message
      const toolResults: string[] = [];

      for (const toolCall of response.toolCalls) {
        logger.tool(toolCall.name, toolCall.arguments);
        this.eventBus?.emitAction(toolCall.name, toolCall.arguments as Record<string, unknown>);
        this.toolsUsedSet.add(toolCall.name);

        let result = '';

        // Check memory tools first
        if (toolCall.name === 'rememberFact' && this.memory) {
          const args = toolCall.arguments as Record<string, unknown>;
          await this.memory.remember(args['key'] as string, args['value'], args['category'] as string);
          result = `Remembered: ${args['key']} = ${args['value']}`;
        } else if (toolCall.name === 'recallFact' && this.memory) {
          const args = toolCall.arguments as Record<string, unknown>;
          const recalled = await this.memory.recall(args['key'] as string);
          result = recalled ? `Recalled: ${JSON.stringify(recalled)}` : 'Nothing found for that key.';
        } else if (toolCall.name === 'searchMemory' && this.memory) {
          const args = toolCall.arguments as Record<string, unknown>;
          const searchResults = await this.memory.search(args['query'] as string);
          result = searchResults.length > 0
            ? searchResults.map(r => `${r.key}: ${JSON.stringify(r.value)}`).join('\n')
            : 'No matching memories found.';
        } else if (toolCall.name === 'searchProfile' && this.memory) {
          const args = toolCall.arguments as Record<string, unknown>;
          const searchResults = await this.memory.searchAll(args['query'] as string);
          const parts: string[] = [];
          if (searchResults.profile.length > 0) {
            parts.push(`Profile:\n${searchResults.profile.join('\n')}`);
          }
          if (searchResults.documents.length > 0) {
            for (const doc of searchResults.documents) {
              parts.push(`Document "${doc.name}" (${doc.type}):\n${doc.snippets.join('\n')}`);
            }
          }
          if (searchResults.items.length > 0) {
            parts.push(`Tracked Items:\n${searchResults.items.map(i => `- [${i.status}] ${i.title} (${i.collection}) ${i.url}`).join('\n')}`);
          }
          if (searchResults.facts.length > 0) {
            parts.push(`Memory Facts:\n${searchResults.facts.map(f => `- ${f.key}: ${JSON.stringify(f.value)}`).join('\n')}`);
          }
          result = parts.length > 0 ? parts.join('\n\n') : 'No matching information found in user data.';
        }

        // If memory tool handled it, skip to result reporting
        if (result) {
          // Already handled by memory tool
        } else {
        // Check rich skills, then built-in skills, then browser actions
        const richSkillHandler = this.skillRegistry?.findRichSkillForTool(toolCall.name);
        if (richSkillHandler && this.skillExecutor) {
          try {
            result = await this.skillExecutor.executeAction(
              richSkillHandler,
              toolCall.name,
              toolCall.arguments as Record<string, unknown>,
            );
          } catch (err) {
            result = `Rich skill error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          // Check built-in skill tools
          const skillHandler = this.findSkillForTool(toolCall.name);
          if (skillHandler) {
            try {
              const skillContext: SkillContext = {
                agent: this,
                browser: this.browser,
                llm: this.llm,
                memory: this.memory as MemoryStore,
              };
              result = await skillHandler.execute(toolCall.name, toolCall.arguments as Record<string, unknown>, skillContext);
            } catch (err) {
              result = `Skill error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else if (this.mcpEngine && toolCall.name !== 'done' && toolCall.name !== 'fail') {
            // MCP browser action — route to MCP engine
            try {
              const mcpResult = await this.mcpEngine.callTool(toolCall.name, toolCall.arguments as Record<string, unknown>);
              result = mcpResult.content
                .map(c => c.text ?? (c.data ? `[${c.mimeType ?? 'binary'} data]` : ''))
                .filter(Boolean)
                .join('\n') || 'Done';
              if (mcpResult.isError) {
                result = `MCP error: ${result}`;
              }
              logger.action(`${toolCall.name} (MCP): ${result.slice(0, 200)}`);
            } catch (err) {
              result = `MCP tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            // Browser action
            const actionResult = await this.actionExecutor.execute(toolCall.name, toolCall.arguments as Record<string, unknown>);
            result = actionResult.message;
            logger.action(`${toolCall.name}: ${result}`);
          }
        }
        } // end of memory-tool else block

        this.eventBus?.emitActionResult(toolCall.name, result);

        step.actions.push({
          name: toolCall.name,
          args: toolCall.arguments as Record<string, unknown>,
          result,
        });

        const argsStr = Object.entries(toolCall.arguments as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        toolResults.push(`- ${toolCall.name}(${argsStr}): ${result}`);

        // Check if done/failed
        if (this.actionExecutor.isDone()) {
          this.state.status = 'completed';
          this.state.result = this.actionExecutor.getResult();
          logger.success(`Task completed: ${this.state.result}`);
          this.eventBus?.emitResult(this.state.result ?? '');
          break;
        }
        if (this.actionExecutor.isFailed()) {
          this.state.status = 'failed';
          this.state.result = this.actionExecutor.getResult();
          logger.error(`Task failed: ${this.state.result}`);
          this.eventBus?.emitError(this.state.result ?? 'Unknown failure');
          break;
        }
      }

      // Capture screenshot after tool execution (skip in MCP mode)
      if (!this.mcpEngine && response.toolCalls.length > 0 && this.state.status === 'running') {
        await this.captureScreenshot();
      }

      // Add batched tool results as a single user message
      if (toolResults.length > 0) {
        this.messages.push({
          role: 'user',
          content: `Tool Results:\n${toolResults.join('\n')}`,
        });
      }

      this.state.history.push(step);
    }

    if (this.state.status === 'running') {
      this.state.status = 'failed';
      this.state.result = `Max steps (${this.state.maxSteps}) reached without completing the task`;
      logger.error(this.state.result);
      this.eventBus?.emitError(this.state.result);
    }

    // Screenshot on failure
    if (this.state.status === 'failed') {
      const failId = crypto.randomUUID().slice(0, 8);
      const screenshotPath = path.join(os.homedir(), '.brmonk', 'screenshots', `failure-${failId}.png`);
      await this.browser.screenshotToFile(screenshotPath);
    }

    // Save session result
    if (this.memory && this.eventBus) {
      let resultStatus: SessionResult['status'];
      if (this.state.status === 'completed') {
        resultStatus = 'completed';
      } else if (this.state.result?.startsWith('Max steps')) {
        resultStatus = 'max-steps';
      } else {
        resultStatus = 'failed';
      }

      const sessionResult: SessionResult = {
        sessionId: this.eventBus.getSessionId(),
        task,
        result: this.state.result ?? '',
        status: resultStatus,
        startedAt: this.startedAt,
        completedAt: new Date().toISOString(),
        steps: this.state.stepCount,
        toolsUsed: Array.from(this.toolsUsedSet),
        urls: this.urlsVisited.size > 0 ? Array.from(this.urlsVisited) : undefined,
      };

      try {
        await this.memory.saveSessionResult(sessionResult);
        this.eventBus.emitSessionResult(sessionResult);
      } catch {
        // Non-critical — don't fail the session over result persistence
      }
    }

    return this.getState();
  }

  private async captureScreenshot(): Promise<void> {
    if (!this.eventBus) return;
    const now = Date.now();
    if (now - this.lastScreenshotTime < this.screenshotInterval) return;
    this.lastScreenshotTime = now;

    try {
      const data = await this.browser.screenshotToBase64();
      if (data) {
        const url = this.browser.getCurrentUrl();
        this.eventBus.emitBrowserScreenshot(data, url);
      }
    } catch {
      // Non-critical
    }
  }

  private findSkillForTool(toolName: string): Skill | null {
    if (!this.skillRegistry) return null;
    for (const skill of this.skillRegistry.listSkills()) {
      if (skill.tools.some(t => t.name === toolName)) {
        return skill;
      }
    }
    return null;
  }
}
