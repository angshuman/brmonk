import { EventEmitter } from 'node:events';
import type { SessionResult } from './memory/types.js';

export type AgentEvent =
  | { type: 'step'; sessionId: string; step: number; maxSteps: number }
  | { type: 'action'; sessionId: string; action: string; args: Record<string, unknown> }
  | { type: 'action-result'; sessionId: string; action: string; result: string }
  | { type: 'thought'; sessionId: string; message: string }
  | { type: 'plan'; sessionId: string; steps: string[] }
  | { type: 'plan-progress'; sessionId: string; stepIndex: number; status: string }
  | { type: 'status'; sessionId: string; status: string }
  | { type: 'result'; sessionId: string; result: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'user-action-required'; sessionId: string; prompt: string; actionType: 'login' | 'captcha' | 'confirmation' }
  | { type: 'user-action-resolved'; sessionId: string }
  | { type: 'popup-dismissed'; sessionId: string; description: string }
  | { type: 'page-navigated'; sessionId: string; url: string }
  | { type: 'session-result'; sessionId: string; sessionResult: SessionResult }
  | { type: 'browser-screenshot'; sessionId: string; data: string; url: string; timestamp: number };

export class AgentEventBus extends EventEmitter {
  private sessionId: string;

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId ?? 'default';
    this.setMaxListeners(50);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  emitEvent(event: AgentEvent): void {
    // IMPORTANT: Do NOT emit on the 'error' channel — Node's EventEmitter
    // treats 'error' as special: if no listener is registered it throws
    // ERR_UNHANDLED_ERROR and crashes the process. We use 'agent-error'
    // for our error events instead.
    const channel = event.type === 'error' ? 'agent-error' : event.type;
    this.emit(channel, event);
    this.emit('*', event);
  }

  onEvent(handler: (event: AgentEvent) => void): void {
    this.on('*', handler);
  }

  offEvent(handler: (event: AgentEvent) => void): void {
    this.off('*', handler);
  }

  emitStep(step: number, maxSteps: number): void {
    this.emitEvent({ type: 'step', sessionId: this.sessionId, step, maxSteps });
  }

  emitAction(action: string, args: Record<string, unknown>): void {
    this.emitEvent({ type: 'action', sessionId: this.sessionId, action, args });
  }

  emitActionResult(action: string, result: string): void {
    this.emitEvent({ type: 'action-result', sessionId: this.sessionId, action, result });
  }

  emitThought(message: string): void {
    this.emitEvent({ type: 'thought', sessionId: this.sessionId, message });
  }

  emitPlan(steps: string[]): void {
    this.emitEvent({ type: 'plan', sessionId: this.sessionId, steps });
  }

  emitPlanProgress(stepIndex: number, status: string): void {
    this.emitEvent({ type: 'plan-progress', sessionId: this.sessionId, stepIndex, status });
  }

  emitStatus(status: string): void {
    this.emitEvent({ type: 'status', sessionId: this.sessionId, status });
  }

  emitResult(result: string): void {
    this.emitEvent({ type: 'result', sessionId: this.sessionId, result });
  }

  emitError(error: string): void {
    this.emitEvent({ type: 'error', sessionId: this.sessionId, error });
  }

  emitUserActionRequired(prompt: string, actionType: 'login' | 'captcha' | 'confirmation'): void {
    this.emitEvent({ type: 'user-action-required', sessionId: this.sessionId, prompt, actionType });
  }

  emitUserActionResolved(): void {
    this.emitEvent({ type: 'user-action-resolved', sessionId: this.sessionId });
  }

  emitPopupDismissed(description: string): void {
    this.emitEvent({ type: 'popup-dismissed', sessionId: this.sessionId, description });
  }

  emitPageNavigated(url: string): void {
    this.emitEvent({ type: 'page-navigated', sessionId: this.sessionId, url });
  }

  emitSessionResult(sessionResult: SessionResult): void {
    this.emitEvent({ type: 'session-result', sessionId: this.sessionId, sessionResult });
  }

  emitBrowserScreenshot(data: string, url: string): void {
    this.emitEvent({ type: 'browser-screenshot', sessionId: this.sessionId, data, url, timestamp: Date.now() });
  }
}
