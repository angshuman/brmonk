import chalk from 'chalk';
import { Renderer, truncate } from '../renderer.js';
import type { AppState } from '../state.js';
import { getActiveSession } from '../state.js';

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function renderSession(renderer: Renderer, state: AppState): void {
  const session = getActiveSession(state);
  if (!session) {
    renderer.writeLine(chalk.red('No active session.'));
    return;
  }

  const elapsed = formatElapsed(Date.now() - session.startTime);
  const stepInfo = `Step ${session.currentStep}/${session.maxSteps} · ${elapsed}`;
  const title = `Session: ${truncate(session.task, renderer.getWidth() - stepInfo.length - 20)}`;
  const content: string[] = [];

  content.push('');

  // Plan section
  if (session.plan.length > 0) {
    content.push(chalk.bold('  Plan'));
    for (let i = 0; i < session.plan.length; i++) {
      const step = session.plan[i];
      if (!step) continue;
      let icon: string;
      if (i < session.planProgress) {
        icon = chalk.green('✓');
      } else if (i === session.planProgress) {
        icon = chalk.yellow('→');
      } else {
        icon = chalk.gray(' ');
      }
      content.push(`  ${icon} ${i + 1}. ${truncate(step, renderer.getWidth() - 12)}`);
    }
    content.push('');
  }

  // Status
  const statusColor = session.status === 'running' ? chalk.green
    : session.status === 'completed' ? chalk.green
    : session.status === 'failed' ? chalk.red
    : chalk.yellow;
  const tokenInfo = session.totalInputTokens > 0
    ? ` · Tokens: ${formatTokens(session.totalInputTokens)}in/${formatTokens(session.totalOutputTokens)}out`
    : '';
  content.push(`  ${chalk.bold('Status')}: ${statusColor(session.status)} · ${chalk.gray(stepInfo)}${chalk.gray(tokenInfo)}`);
  content.push('');

  // Agent log
  content.push(chalk.bold('  Agent Log'));
  const visibleLog = session.log.slice(-Math.max(5, renderer.getHeight() - 20));
  if (visibleLog.length === 0) {
    content.push(chalk.gray('  (no activity yet)'));
  }
  for (const entry of visibleLog) {
    let icon: string;
    let color: (s: string) => string;
    switch (entry.type) {
      case 'action': icon = '⚡'; color = chalk.cyan; break;
      case 'result': icon = '→'; color = chalk.white; break;
      case 'thought': icon = '💭'; color = chalk.gray; break;
      case 'error': icon = '✗'; color = chalk.red; break;
      default: icon = '·'; color = chalk.gray; break;
    }
    content.push(`  ${icon} ${color(truncate(entry.message, renderer.getWidth() - 10))}`);
  }
  content.push('');

  // Current action
  if (session.currentAction) {
    content.push(`  ${chalk.yellow('⏳')} ${chalk.yellow(truncate(session.currentAction, renderer.getWidth() - 10))}`);
    content.push('');
  }

  // Result
  if (session.result) {
    content.push(`  ${chalk.bold('Result')}: ${session.result}`);
    content.push('');
  }

  // Message input mode
  if (state.messageInputMode) {
    content.push(`  ${chalk.cyan('Message>')} ${state.messageBuffer}${chalk.gray('█')}`);
    content.push(chalk.gray('  [Enter] Send  [Esc] Cancel'));
  } else {
    content.push(chalk.gray('  [m] Send message  [p] Pause/Resume  [s] Screenshot  [b] Back'));
  }

  const lines = renderer.drawBox(title, content, {
    borderColor: session.status === 'running' ? 'green' : session.status === 'failed' ? 'red' : 'gray',
    titleColor: 'white',
  });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}
