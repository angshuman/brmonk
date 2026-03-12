import * as crypto from 'node:crypto';
import { Renderer } from './renderer.js';
import { createInitialState, addSession, getActiveSession, addLogEntry, type AppState } from './state.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSession } from './views/session.js';
import { renderInput } from './views/input.js';
import { renderActionRequired } from './views/action-required.js';
import { renderProfile } from './views/profile.js';
import { AgentEventBus, type AgentEvent } from '../events.js';
import type { BrowserEngine } from '../browser/engine.js';
import type { LLMProvider } from '../llm/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { MemoryStore } from '../memory/store.js';
import { AgentLoop } from '../agent/loop.js';

export class TUIApp {
  private renderer: Renderer;
  private state: AppState;
  private browser: BrowserEngine;
  private llm: LLMProvider;
  private skillRegistry: SkillRegistry;
  private memory: MemoryStore;
  private eventBus: AgentEventBus;
  private currentAgent: AgentLoop | null = null;
  private maxSteps: number;
  private renderScheduled = false;

  constructor(options: {
    browser: BrowserEngine;
    llm: LLMProvider;
    skillRegistry: SkillRegistry;
    memory: MemoryStore;
    maxSteps?: number;
  }) {
    this.renderer = new Renderer();
    this.state = createInitialState();
    this.browser = options.browser;
    this.llm = options.llm;
    this.skillRegistry = options.skillRegistry;
    this.memory = options.memory;
    this.maxSteps = options.maxSteps ?? 50;
    this.eventBus = new AgentEventBus();

    this.eventBus.onEvent((event: AgentEvent) => {
      this.handleAgentEvent(event);
    });
  }

  async start(): Promise<void> {
    // Load profile info
    await this.loadProfileInfo();

    // Setup raw input mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    this.renderer.hideCursor();
    this.render();

    process.stdin.on('data', (key: string) => {
      this.handleKeyPress(key);
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.renderer.refresh();
      this.render();
    });
  }

  private async loadProfileInfo(): Promise<void> {
    try {
      const profile = await this.memory.getProfile();
      if (profile && profile.name) {
        const items = await this.memory.getItems();
        const documents = await this.memory.getDocuments();
        const collections = await this.memory.getCollections();
        this.state.profile = {
          name: profile.name,
          documentCount: documents.length,
          itemCount: items.length,
          collections,
        };
      }
    } catch {
      // No profile
    }
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      this.render();
    }, 50);
  }

  private render(): void {
    this.renderer.refresh();

    switch (this.state.currentView) {
      case 'dashboard':
        renderDashboard(this.renderer, this.state);
        break;
      case 'session':
        renderSession(this.renderer, this.state);
        break;
      case 'input':
        renderInput(this.renderer, this.state);
        break;
      case 'action-required':
        renderActionRequired(this.renderer, this.state);
        break;
      case 'profile':
        renderProfile(this.renderer, this.state);
        break;
    }

    this.renderer.flush();
  }

  private handleKeyPress(key: string): void {
    // Ctrl+C always quits
    if (key === '\x03') {
      this.cleanup();
      return;
    }

    switch (this.state.currentView) {
      case 'dashboard':
        this.handleDashboardKey(key);
        break;
      case 'session':
        this.handleSessionKey(key);
        break;
      case 'input':
        this.handleInputKey(key);
        break;
      case 'action-required':
        this.handleActionRequiredKey(key);
        break;
      case 'profile':
        this.handleProfileKey(key);
        break;
    }
  }

  private handleDashboardKey(key: string): void {
    switch (key) {
      case 'n':
        this.state.currentView = 'input';
        this.state.inputBuffer = '';
        this.render();
        break;
      case 'q':
        this.cleanup();
        break;
      case 'p':
        this.state.currentView = 'profile';
        this.render();
        break;
      case '\r': // Enter
        if (this.state.sessions.length > 0 && this.state.activeSessionIndex >= 0) {
          this.state.currentView = 'session';
          this.render();
        }
        break;
      case '\x1b[A': // Up arrow
      case 'k': // Vim up
        if (this.state.activeSessionIndex > 0) {
          this.state.activeSessionIndex--;
          this.render();
        }
        break;
      case '\x1b[B': // Down arrow
      case 'j': // Vim down
        if (this.state.activeSessionIndex < this.state.sessions.length - 1) {
          this.state.activeSessionIndex++;
          this.render();
        }
        break;
      default:
        break;
    }
  }

  private handleSessionKey(key: string): void {
    // Message input mode
    if (this.state.messageInputMode) {
      if (key === '\x1b') { // Escape
        this.state.messageInputMode = false;
        this.state.messageBuffer = '';
        this.render();
        return;
      }
      if (key === '\r') { // Enter — send message
        const msg = this.state.messageBuffer.trim();
        if (msg && this.currentAgent) {
          this.currentAgent.injectMessage(msg);
          const session = getActiveSession(this.state);
          if (session) {
            addLogEntry(session, 'info', `You: ${msg}`);
          }
        }
        this.state.messageInputMode = false;
        this.state.messageBuffer = '';
        this.render();
        return;
      }
      if (key === '\x7f' || key === '\b') { // Backspace
        this.state.messageBuffer = this.state.messageBuffer.slice(0, -1);
        this.render();
        return;
      }
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        this.state.messageBuffer += key;
        this.render();
      }
      return;
    }

    switch (key) {
      case 'b':
        this.state.currentView = 'dashboard';
        this.render();
        break;
      case 'm': // Send message to agent
      case '\r': // Enter
        this.state.messageInputMode = true;
        this.state.messageBuffer = '';
        this.render();
        break;
      case 'p': {
        if (this.currentAgent) {
          const session = getActiveSession(this.state);
          if (session && session.status === 'running') {
            this.currentAgent.pause();
            session.status = 'paused';
          } else if (session && session.status === 'paused') {
            this.currentAgent.resume();
            session.status = 'running';
          }
          this.render();
        }
        break;
      }
      case '\x1b': // Escape
        this.state.currentView = 'dashboard';
        this.render();
        break;
      default:
        break;
    }
  }

  private handleInputKey(key: string): void {
    if (key === '\x1b') { // Escape
      this.state.currentView = 'dashboard';
      this.state.inputBuffer = '';
      this.render();
      return;
    }

    if (key === '\r') { // Enter
      const task = this.state.inputBuffer.trim();
      if (task) {
        this.startTask(task);
      }
      return;
    }

    if (key === '\x7f' || key === '\b') { // Backspace
      this.state.inputBuffer = this.state.inputBuffer.slice(0, -1);
      this.render();
      return;
    }

    // Regular character
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      this.state.inputBuffer += key;
      this.render();
    }
  }

  private handleActionRequiredKey(key: string): void {
    if (key === '\r') { // Enter - user is done
      this.browser.resolveUserAction();
      this.state.currentView = 'session';
      this.render();
    } else if (key === 's') { // Skip
      this.browser.resolveUserAction();
      this.state.currentView = 'session';
      this.render();
    } else if (key === 'q') { // Cancel
      this.browser.resolveUserAction();
      this.state.currentView = 'dashboard';
      this.render();
    }
  }

  private handleProfileKey(key: string): void {
    if (key === 'b' || key === '\x1b') {
      this.state.currentView = 'dashboard';
      this.render();
    }
  }

  private startTask(task: string): void {
    const sessionId = crypto.randomUUID().slice(0, 8);
    this.eventBus.setSessionId(sessionId);
    addSession(this.state, sessionId, task);

    this.state.currentView = 'session';
    this.state.inputBuffer = '';
    this.render();

    this.currentAgent = new AgentLoop({
      llm: this.llm,
      browser: this.browser,
      skillRegistry: this.skillRegistry,
      memory: this.memory,
      eventBus: this.eventBus,
      maxSteps: this.maxSteps,
    });

    // Run the agent in background
    void this.currentAgent.run(task).then(async (agentState) => {
      const session = getActiveSession(this.state);
      if (session) {
        session.status = agentState.status as typeof session.status;
        session.result = agentState.result;
        session.totalInputTokens = agentState.totalInputTokens;
        session.totalOutputTokens = agentState.totalOutputTokens;
        addLogEntry(session, agentState.status === 'completed' ? 'result' : 'error',
          agentState.result ?? 'Task ended');
      }

      // Save session to memory
      await this.memory.saveSession(sessionId, agentState.history, task);
      this.currentAgent = null;
      this.scheduleRender();
    }).catch((err) => {
      const session = getActiveSession(this.state);
      if (session) {
        session.status = 'failed';
        session.result = err instanceof Error ? err.message : String(err);
        addLogEntry(session, 'error', session.result);
      }
      this.currentAgent = null;
      this.scheduleRender();
    });
  }

  private handleAgentEvent(event: AgentEvent): void {
    const session = this.state.sessions.find(s => s.id === event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'step':
        session.currentStep = event.step;
        session.maxSteps = event.maxSteps;
        break;
      case 'action':
        session.currentAction = `${event.action}(${Object.values(event.args).map(v => JSON.stringify(v)).join(', ')})`;
        addLogEntry(session, 'action', session.currentAction);
        break;
      case 'action-result':
        session.currentAction = '';
        addLogEntry(session, 'result', `${event.action}: ${event.result.slice(0, 200)}`);
        break;
      case 'thought':
        addLogEntry(session, 'thought', event.message.slice(0, 200));
        break;
      case 'plan':
        session.plan = event.steps;
        session.planProgress = 0;
        break;
      case 'plan-progress':
        session.planProgress = event.stepIndex;
        break;
      case 'status':
        session.status = event.status as typeof session.status;
        break;
      case 'result':
        session.result = event.result;
        session.status = 'completed';
        addLogEntry(session, 'result', event.result);
        break;
      case 'error':
        addLogEntry(session, 'error', event.error);
        break;
      case 'user-action-required':
        this.state.actionPrompt = event.prompt;
        this.state.actionType = event.actionType;
        this.state.currentView = 'action-required';
        break;
      case 'user-action-resolved':
        if (this.state.currentView === 'action-required') {
          this.state.currentView = 'session';
        }
        break;
      case 'popup-dismissed':
        addLogEntry(session, 'info', `Popup dismissed: ${event.description}`);
        break;
      case 'page-navigated':
        try {
          session.domain = new URL(event.url).hostname;
        } catch {
          session.domain = '';
        }
        addLogEntry(session, 'info', `Navigated to ${event.url}`);
        break;
    }

    this.scheduleRender();
  }

  private cleanup(): void {
    this.renderer.showCursor();
    this.renderer.clear();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  }
}
