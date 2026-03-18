import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
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

## Strategy — Be Efficient
You have a limited step budget. Every tool call counts as progress toward that budget.

**Planning before acting:**
1. Read the full page state ONCE, then plan your sequence of actions
2. Identify the optimal order: e.g., if a page has a search bar AND filters, decide which to use first based on what narrows results fastest
3. For forms with multiple fields: plan all fields, then fill them in order, then submit — don't re-observe between each field unless something fails

**Be decisive, not tentative:**
- If you can see the element you need, act on it immediately — don't scroll around exploring first
- If a click didn't work, try clickByText or evaluate() as alternatives — don't retry the same approach
- If you need data from a page, use evaluate() to extract it all at once rather than clicking through elements one by one
- Use goTo(url) directly when you know the URL instead of navigating through menus

**When things go wrong:**
- If an action fails, CHANGE your approach — use a different selector, try JavaScript, or navigate differently
- If the page looks the same after an action, the action probably didn't work — try an alternative immediately
- If you're stuck in a loop (same page, same state), step back and try a completely different strategy
- Never repeat the same failing action more than once

**Avoid wasting steps:**
- Don't call screenshot() just to look — you already get the page state each step
- Don't call waitForLoad() after every click — only when navigating to a new page
- Don't dismiss popups manually — they're auto-dismissed for you before each step
- If "Page unchanged from previous observation" appears, your last action had no effect — change approach

## Data Collection — Think Ahead
As you browse, **actively collect data the user will want in the final result**, even if they didn't explicitly ask for it. For example:
- If searching for products: collect names, prices, ratings, AND links to each product page
- If researching companies: collect names, descriptions, AND links to their websites
- If finding jobs: collect titles, companies, locations, AND application URLs
- If comparing options: collect ALL relevant attributes for each option in a structured way

Use **evaluate()** to extract structured data (links, prices, details) from a page in one shot instead of reading elements one by one. For example:
\`\`\`
evaluate("return [...document.querySelectorAll('.result')].map(el => ({title: el.querySelector('h3')?.textContent, url: el.querySelector('a')?.href, description: el.querySelector('.desc')?.textContent}))")
\`\`\`

## Completion — Deliver a Useful Report
When calling **done(result)**, think about what the user ACTUALLY wants to do with this information. They will read your result like a report. Make it complete and actionable.

**ALWAYS include in your result:**
1. **Direct links/URLs** — the #1 most common missing piece. If you visited pages, include those URLs. If results have links, include them. Never describe something you found online without its URL.
2. **Structured data** — present findings in a clear format (use markdown tables, numbered lists, or sections). Don't dump a wall of text.
3. **Specific details** — names, numbers, prices, dates, descriptions. Not vague summaries.
4. **Source attribution** — where did each piece of information come from?

**Result format by task type:**
- **Search/research tasks**: Return a structured list of findings, each with title, key details, and source URL. Example:
  "Found 5 options:\n1. **Product Name** — $99, 4.5★ rating, free shipping\n   Link: https://example.com/product\n2. ..."
- **Data extraction tasks**: Return the extracted data in a clean, structured format (table or list)
- **Action tasks** (fill form, make purchase, sign up): Confirm what was done, include confirmation numbers, screenshots, or URLs proving completion
- **Comparison tasks**: Present a side-by-side comparison with all relevant attributes and source links

**Bad result**: "I found several restaurants in the area with good ratings."
**Good result**: "Found 5 top-rated restaurants:\n1. **Sushi Zen** — 4.8★ (342 reviews), $$, Japanese\n   📍 123 Main St · 📞 555-0123\n   🔗 https://yelp.com/biz/sushi-zen\n2. ..."

- Use **fail(reason)** only when the task genuinely cannot be completed after reasonable attempts.
- Always prefer done() over fail() — be persistent and creative.
- When running low on steps, wrap up with the best partial result using done() rather than running out — a partial result with links is better than a complete result without them.`;

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
  private consecutiveUnchanged = 0;
  private lastCaptchaCheckTime = 0;
  private lastCaptchaCheckUrl = '';
  private startedAt = '';
  private toolsUsedSet = new Set<string>();
  private urlsVisited = new Set<string>();
  private collectedLinks = new Map<string, string>(); // url -> context/title
  private lastScreenshotTime = 0;
  private screenshotInterval = 2000; // minimum ms between screenshots
  private lastFileSaveTime = 0;
  private fileSaveInterval = 5000; // 5 seconds between file saves
  private filesDir: string | null = null;
  private currentTools: LLMToolDefinition[] = [];

  constructor(options: {
    llm: LLMProvider;
    browser: BrowserEngine;
    mcpEngine?: McpBrowserEngine;
    skillRegistry?: SkillRegistry;
    memory?: MemoryStore;
    eventBus?: AgentEventBus;
    maxSteps?: number;
    filesDir?: string;
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
    this.filesDir = options.filesDir ?? null;
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
    const urlsSeen = new Set<string>();
    const errors: string[] = [];
    const keyFindings: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Extract URLs visited from page state observations
        const urlMatch = msg.content.match(/URL:\s*(https?:\/\/[^\s]+)/);
        if (urlMatch) urlsSeen.add(urlMatch[1]);

        // Extract tool results
        if (msg.content.startsWith('Tool Results:')) {
          const lines = msg.content.split('\n').filter(l => l.startsWith('- '));
          for (const line of lines) {
            const trimmed = line.slice(2).slice(0, 150);
            actions.push(trimmed);
            // Detect errors in tool results
            if (/error|failed|timeout|blocked|denied/i.test(trimmed)) {
              errors.push(trimmed.slice(0, 100));
            }
            // Detect successful data extraction
            if (/done\(|extracted|found|result/i.test(trimmed)) {
              keyFindings.push(trimmed.slice(0, 100));
            }
          }
        }

        // Detect stuck warnings
        if (msg.content.includes('STUCK DETECTED') || msg.content.includes('Page unchanged')) {
          errors.push('Agent got stuck (page unchanged)');
        }
      } else if (msg.role === 'assistant' && msg.content) {
        const short = msg.content.slice(0, 120);
        actions.push(`Thought: ${short}`);
      }
    }

    const parts: string[] = [];

    if (urlsSeen.size > 0) {
      parts.push(`URLs visited: ${Array.from(urlsSeen).join(', ')}`);
    }

    if (keyFindings.length > 0) {
      parts.push(`Key findings:\n${keyFindings.slice(-5).map(f => `  - ${f}`).join('\n')}`);
    }

    if (errors.length > 0) {
      const uniqueErrors = [...new Set(errors)];
      parts.push(`Errors encountered (avoid repeating these):\n${uniqueErrors.slice(-5).map(e => `  - ${e}`).join('\n')}`);
    }

    if (actions.length > 0) {
      parts.push(`Recent actions:\n${actions.slice(-10).map(a => `  - ${a}`).join('\n')}`);
    }

    // Include collected links count so the LLM knows data is accumulating
    if (this.collectedLinks.size > 0) {
      const sampleLinks = [...this.collectedLinks.entries()].slice(-5);
      parts.push(`Data collected so far: ${this.collectedLinks.size} links tracked. Recent:\n${sampleLinks.map(([url, ctx]) => ctx ? `  - ${ctx}: ${url}` : `  - ${url}`).join('\n')}`);
    }

    if (parts.length === 0) return 'No significant actions taken yet.';
    return `Summary of previous steps:\n${parts.join('\n\n')}`;
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
    this.consecutiveUnchanged = 0;
    this.actionExecutor.resetStatus();
    this.startedAt = new Date().toISOString();
    this.toolsUsedSet.clear();
    this.urlsVisited.clear();
    this.collectedLinks.clear();

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
    this.currentTools = allTools;

    return this.runLoop();
  }

  /** Continue a finished session with a follow-up message, preserving conversation history. */
  async continueWith(followUp: string): Promise<AgentState> {
    const previousMessages = [...this.messages];

    this.state.status = 'running';
    this.state.result = null;
    this.state.stepCount = 0;
    this.paused = false;
    this.lastObservationHash = '';
    this.pendingMessages = [];
    this.consecutiveUnchanged = 0;
    this.actionExecutor.resetStatus();
    this.startedAt = new Date().toISOString();

    this.messages = previousMessages;
    this.messages.push({ role: 'user', content: `Follow-up from user: ${followUp}` });

    logger.thought(`Continuing with follow-up: ${followUp}`);
    this.eventBus?.emitStatus('running');
    this.eventBus?.emitThought(`Continuing with follow-up: ${followUp}`);

    return this.runLoop();
  }

  private async runLoop(): Promise<AgentState> {
    const allTools = this.currentTools;
    const task = this.state.taskDescription;

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

      // Extract links from page observations (DOM snapshots contain href attributes)
      if (observation !== 'Page unchanged from previous observation.' && observation !== 'No page loaded yet. Use goTo(url) to navigate to a website.') {
        const hrefMatches = observation.matchAll(/href="(https?:\/\/[^"]+)"/g);
        for (const match of hrefMatches) {
          const url = match[1];
          if (url && !url.includes('localhost') && !url.includes('127.0.0.1')) {
            // Try to find context from nearby text — look for the link text before the href
            const idx = observation.indexOf(match[0]);
            const preceding = observation.slice(Math.max(0, idx - 80), idx);
            const textMatch = preceding.match(/"([^"]{3,60})"\s*$/);
            if (textMatch?.[1] && !this.collectedLinks.has(url)) {
              this.collectedLinks.set(url, textMatch[1]);
            } else if (!this.collectedLinks.has(url)) {
              this.collectedLinks.set(url, '');
            }
          }
        }
      }

      // Track consecutive unchanged observations
      if (observation === 'Page unchanged from previous observation.') {
        this.consecutiveUnchanged++;
      } else {
        this.consecutiveUnchanged = 0;
      }

      // Build observation with step budget awareness and failure hints
      let enrichedObservation = `Current page state:\n${observation}`;

      // Step budget awareness — let the LLM know where it stands
      const remaining = this.state.maxSteps - this.state.stepCount;
      const pctUsed = Math.round((this.state.stepCount / this.state.maxSteps) * 100);
      if (pctUsed >= 80) {
        enrichedObservation += `\n\n⚠️ STEP BUDGET CRITICAL: ${remaining} steps remaining out of ${this.state.maxSteps} (${pctUsed}% used). Wrap up NOW — call done() with your best partial result.`;
      } else if (pctUsed >= 60) {
        enrichedObservation += `\n\n⏱️ Step budget: ${remaining} steps remaining (${pctUsed}% used). Start wrapping up — focus only on the core task.`;
      } else if (pctUsed >= 40) {
        enrichedObservation += `\n\nStep ${this.state.stepCount}/${this.state.maxSteps} — ${remaining} steps remaining.`;
      }

      // Consecutive failure detection — inject strategy change hints
      if (this.consecutiveUnchanged >= 3) {
        enrichedObservation += `\n\n🚨 STUCK DETECTED: Page has been unchanged for ${this.consecutiveUnchanged} consecutive steps. Your actions are having NO effect. You MUST change strategy immediately:\n- Try evaluate() to run JavaScript directly\n- Try clickByText() or fillFormField() instead of click()/type()\n- Try goTo() to navigate to a different URL\n- Try scrolling to reveal hidden elements\n- If truly stuck, call done() with partial results rather than wasting more steps`;
      } else if (this.consecutiveUnchanged >= 2) {
        enrichedObservation += `\n\n⚠️ Page unchanged for 2 steps in a row. Your last action had no effect. Try a different approach.`;
      }

      // Add observation to messages
      this.messages.push({
        role: 'user',
        content: enrichedObservation,
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

            // On explicit screenshot() call, emit to viewport and save to Files pane
            if (toolCall.name === 'screenshot') {
              const now = Date.now();
              let snapData: string | null = null;
              let snapUrl = '';
              if (this.mcpEngine) {
                snapData = await this.mcpEngine.screenshotToBase64().catch(() => null);
                if (snapData) snapUrl = await this.mcpEngine.getCurrentUrl().catch(() => '');
              } else {
                snapData = await this.browser.screenshotToBase64().catch(() => null);
                if (snapData) snapUrl = this.browser.getCurrentUrl();
              }
              if (snapData) {
                this.eventBus?.emitBrowserScreenshot(snapData, snapUrl);
                if (this.filesDir) await this.saveScreenshotFile(snapData, snapUrl, now);
              }
            }
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
          this.state.result = this.enrichResult(this.actionExecutor.getResult() ?? '');
          logger.success(`Task completed: ${this.state.result}`);
          this.eventBus?.emitResult(this.state.result ?? '');
          // Save final screenshot to Files pane only if task mentions screenshot
          if (/screenshot/i.test(this.state.taskDescription)) {
            let finalData: string | null = null;
            let finalUrl = '';
            if (this.mcpEngine) {
              finalData = await this.mcpEngine.screenshotToBase64().catch(() => null);
              if (finalData) finalUrl = await this.mcpEngine.getCurrentUrl().catch(() => '');
            } else {
              finalData = await this.browser.screenshotToBase64().catch(() => null);
              if (finalData) finalUrl = this.browser.getCurrentUrl();
            }
            if (finalData) await this.saveScreenshotFile(finalData, finalUrl, Date.now());
          }
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


      // Extract links from tool results for tracking
      for (const tr of toolResults) {
        const urlMatches = tr.matchAll(/https?:\/\/[^\s"',)\]]+/g);
        for (const match of urlMatches) {
          const url = match[0].replace(/[.;:]+$/, ''); // trim trailing punctuation
          if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
            // Derive context from surrounding text
            const contextMatch = tr.match(/(?:title|name|heading)["']?:\s*["']?([^"',\n]{3,60})/i);
            this.collectedLinks.set(url, contextMatch?.[1]?.trim() ?? '');
          }
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
      // Graceful max-steps: attempt a final LLM call to summarize partial progress
      logger.thought('Step budget exhausted — attempting to summarize partial progress...');
      this.eventBus?.emitThought('Step budget exhausted — summarizing partial progress...');

      try {
        // Build context about collected links for the summary
        const linkContext = this.collectedLinks.size > 0
          ? `\n\nLinks collected during browsing:\n${[...this.collectedLinks.entries()].slice(0, 15).map(([url, ctx]) => ctx ? `- ${ctx}: ${url}` : `- ${url}`).join('\n')}`
          : '';
        const urlContext = this.urlsVisited.size > 0
          ? `\n\nPages visited:\n${[...this.urlsVisited].slice(0, 10).map(u => `- ${u}`).join('\n')}`
          : '';

        const summaryPrompt: LLMMessage = {
          role: 'user',
          content: `You have run out of steps. The task was: "${task}"

Summarize what you accomplished so far as a USEFUL result for the user. Format your response in markdown.

**Critical requirements:**
1. Include ALL URLs and links you found — the user needs clickable links
2. Structure the data clearly (numbered lists, tables, sections)
3. Include specific details (names, prices, dates, descriptions)
4. Clearly mark what was completed vs. what remains unfinished
${urlContext}${linkContext}

Write the result as if the user will never see anything else from this session.`,
        };

        const summaryMessages = [
          this.messages[0], // system
          this.messages[1], // task
          ...this.messages.slice(-6), // recent context
          summaryPrompt,
        ];

        const summaryResponse = await this.llm.chat(summaryMessages, {
          maxTokens: 1024,
          temperature: 0.1,
        });

        const rawResult = summaryResponse.content || `Max steps (${this.state.maxSteps}) reached without completing the task`;
        this.state.status = 'max-steps';
        this.state.result = this.enrichResult(rawResult);
        logger.thought(`Partial result: ${this.state.result.slice(0, 200)}`);
        this.eventBus?.emitResult(this.state.result);
      } catch {
        // If even the summary call fails, fall back to basic message
        this.state.status = 'max-steps';
        this.state.result = `Max steps (${this.state.maxSteps}) reached without completing the task`;
        this.eventBus?.emitResult(this.state.result);
      }
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

  /**
   * Enrich the agent's result by appending collected URLs/links
   * that are missing from the result text.
   */
  private enrichResult(result: string): string {
    if (!result) return result;

    // Collect URLs already present in the result
    const existingUrls = new Set<string>();
    const existingMatches = result.matchAll(/https?:\/\/[^\s"',)\]]+/g);
    for (const m of existingMatches) {
      existingUrls.add(m[0].replace(/[.;:]+$/, ''));
    }

    // Find visited URLs not already mentioned in the result
    const missingLinks: { url: string; context: string }[] = [];
    for (const url of this.urlsVisited) {
      // Skip generic/navigation URLs
      if (url.includes('about:blank') || url.includes('chrome://') || url.includes('data:')) continue;
      // Check if already in the result (also check without trailing slash)
      const normalizedUrl = url.replace(/\/$/, '');
      const alreadyCited = [...existingUrls].some(eu => {
        const normExisting = eu.replace(/\/$/, '');
        return normExisting === normalizedUrl || normalizedUrl.startsWith(normExisting) || normExisting.startsWith(normalizedUrl);
      });
      if (!alreadyCited) {
        missingLinks.push({ url, context: this.collectedLinks.get(url) ?? '' });
      }
    }

    // Also check collected links from evaluate() results that aren't visited URLs
    for (const [url, context] of this.collectedLinks) {
      if (this.urlsVisited.has(url)) continue; // already handled above
      const normalizedUrl = url.replace(/\/$/, '');
      const alreadyCited = [...existingUrls].some(eu => {
        const normExisting = eu.replace(/\/$/, '');
        return normExisting === normalizedUrl || normalizedUrl.startsWith(normExisting) || normExisting.startsWith(normalizedUrl);
      });
      if (!alreadyCited && !missingLinks.some(ml => ml.url === url)) {
        missingLinks.push({ url, context });
      }
    }

    // If there are significant missing links, append them
    if (missingLinks.length > 0 && missingLinks.length <= 20) {
      const linksSection = missingLinks.map(({ url, context }) => {
        return context ? `- ${context}: ${url}` : `- ${url}`;
      }).join('\n');
      result += `\n\n---\n**Sources & Links:**\n${linksSection}`;
    }

    return result;
  }

  private async captureScreenshot(): Promise<void> {
    if (!this.eventBus) return;
    const now = Date.now();
    if (now - this.lastScreenshotTime < this.screenshotInterval) return;
    this.lastScreenshotTime = now;

    try {
      let data: string | null = null;
      let pageUrl = '';

      if (this.mcpEngine) {
        // MCP mode: capture via MCP screenshot tool
        data = await this.mcpEngine.screenshotToBase64();
        if (data) pageUrl = await this.mcpEngine.getCurrentUrl();
      } else {
        // Direct Playwright mode
        data = await this.browser.screenshotToBase64();
        if (data) pageUrl = this.browser.getCurrentUrl();
      }

      if (data) {
        this.eventBus.emitBrowserScreenshot(data, pageUrl);

        // Save to file at lower frequency for the Files pane
        if (this.filesDir && now - this.lastFileSaveTime >= this.fileSaveInterval) {
          await this.saveScreenshotFile(data, pageUrl, now);
        }
      }
    } catch {
      // Non-critical
    }
  }

  private async saveScreenshotFile(data: string, pageUrl = '', now: number = Date.now()): Promise<void> {
    if (!this.filesDir || !this.eventBus) return;
    this.lastFileSaveTime = now;
    const sessionId = this.eventBus.getSessionId();
    const sessionFilesDir = path.join(this.filesDir, sessionId);
    const fileId = `screenshot-${now}`;
    const filename = `${fileId}.jpg`;
    const filePath = path.join(sessionFilesDir, filename);
    const fileUrl = `/files/${sessionId}/${filename}`;
    try {
      await fs.mkdir(sessionFilesDir, { recursive: true });
      await fs.writeFile(filePath, Buffer.from(data, 'base64'));
      const stat = await fs.stat(filePath);
      this.eventBus.emitFileCreated(fileId, filename, 'image/jpeg', fileUrl, data, stat.size);
      logger.info(`Screenshot saved: ${filePath}`);
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
