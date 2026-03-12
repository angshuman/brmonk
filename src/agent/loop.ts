import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LLMProvider, LLMMessage, LLMToolDefinition } from '../llm/types.js';
import type { BrowserEngine } from '../browser/engine.js';
import { ActionExecutor, getBrowserToolDefinitions } from '../browser/actions.js';
import { extractDOM } from '../browser/dom.js';
import { TaskPlanner } from './planner.js';
import type { AgentState, AgentStep, TaskPlan } from './types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { Skill, SkillContext } from '../skills/types.js';
import type { MemoryStore } from '../memory/store.js';
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
  private actionExecutor: ActionExecutor;
  private planner: TaskPlanner;
  private skillRegistry: SkillRegistry | null;
  private memory: MemoryStore | null;
  private eventBus: AgentEventBus | null;
  private state: AgentState;
  private messages: LLMMessage[] = [];
  private paused = false;
  private pauseResolver: (() => void) | null = null;
  private lastObservationHash = '';
  private pendingMessages: string[] = [];

  constructor(options: {
    llm: LLMProvider;
    browser: BrowserEngine;
    skillRegistry?: SkillRegistry;
    memory?: MemoryStore;
    eventBus?: AgentEventBus;
    maxSteps?: number;
  }) {
    this.llm = options.llm;
    this.browser = options.browser;
    this.actionExecutor = new ActionExecutor(options.browser);
    this.planner = new TaskPlanner(options.llm);
    this.skillRegistry = options.skillRegistry ?? null;
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
    }

    // Add skill system prompts
    const skillTools: LLMToolDefinition[] = [];
    if (this.skillRegistry) {
      for (const skill of this.skillRegistry.listSkills()) {
        if (skill.systemPrompt) {
          systemPrompt += `\n\n## Skill: ${skill.name}\n${skill.systemPrompt}`;
        }
        skillTools.push(...skill.tools);
      }
    }

    this.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Task: ${task}` },
    ];

    // Build tools list
    const browserTools = getBrowserToolDefinitions();
    const allTools = [...browserTools, ...skillTools];

    // Main agent loop
    while (this.state.stepCount < this.state.maxSteps && this.state.status === 'running') {
      await this.waitIfPaused();
      if (this.state.status !== 'running') break;

      this.state.stepCount++;
      logger.thought(`Step ${this.state.stepCount}/${this.state.maxSteps}`);
      this.eventBus?.emitStep(this.state.stepCount, this.state.maxSteps);

      // Pre-step: auto-dismiss popups (only after navigation)
      if (this.browser.shouldDismissPopups()) {
        try {
          const dismissed = await this.browser.dismissPopups();
          for (const d of dismissed) {
            this.eventBus?.emitPopupDismissed(d);
          }
        } catch {
          // Page may not be loaded yet
        }
      }

      // Pre-step: detect CAPTCHA
      try {
        const hasCaptcha = await this.browser.detectCaptcha();
        if (hasCaptcha) {
          logger.thought('CAPTCHA detected — waiting for user to solve it');
          this.state.status = 'waiting-for-user';
          this.eventBus?.emitUserActionRequired('CAPTCHA detected. Please solve the CAPTCHA in the browser window.', 'captcha');
          await this.browser.waitForUserAction('Please solve the CAPTCHA in the browser window, then press Enter to continue.');
          this.state.status = 'running';
          this.eventBus?.emitStatus('running');
        }
      } catch {
        // Detection failed, continue
      }

      // Pre-step: detect login page
      try {
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

      // OBSERVE: Extract DOM state
      let observation: string;
      try {
        const page = this.browser.currentPage();
        const dom = await extractDOM(page);
        this.actionExecutor.updateElementMap(dom.elementMap);
        this.state.currentUrl = dom.url;
        this.state.pageTitle = dom.title;
        this.state.domSnapshot = dom.textRepresentation;

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

        let result: string;

        // Check if it's a skill tool
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
        } else {
          // Browser action
          const actionResult = await this.actionExecutor.execute(toolCall.name, toolCall.arguments as Record<string, unknown>);
          result = actionResult.message;
          logger.action(`${toolCall.name}: ${result}`);
        }

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
      const sessionId = crypto.randomUUID().slice(0, 8);
      const screenshotPath = path.join(os.homedir(), '.brmonk', 'screenshots', `failure-${sessionId}.png`);
      await this.browser.screenshotToFile(screenshotPath);
    }

    return this.getState();
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
