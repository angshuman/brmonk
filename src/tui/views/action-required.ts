import chalk from 'chalk';
import { Renderer } from '../renderer.js';
import type { AppState } from '../state.js';

export function renderActionRequired(renderer: Renderer, state: AppState): void {
  const content: string[] = [];

  content.push('');

  const typeIcon = state.actionType === 'login' ? '🔐'
    : state.actionType === 'captcha' ? '🧩'
    : '⚠';

  const typeLabel = state.actionType === 'login' ? 'Login Required'
    : state.actionType === 'captcha' ? 'CAPTCHA Detected'
    : 'Action Required';

  content.push(`  ${typeIcon} ${chalk.bold.yellow(typeLabel)}`);
  content.push('');
  content.push(`  ${state.actionPrompt}`);
  content.push('');
  content.push(chalk.gray('  Please switch to the browser window and complete the action.'));
  content.push(chalk.gray('  The agent will continue once you are done.'));
  content.push('');
  content.push(chalk.gray('  [Enter] I\'m done, continue  [s] Skip  [q] Cancel task'));

  const lines = renderer.drawBox('Action Required', content, { borderColor: 'yellow', titleColor: 'yellow' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}
