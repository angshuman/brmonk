import chalk from 'chalk';
import { Renderer, truncate } from '../renderer.js';
import type { AppState, SessionState } from '../state.js';

function statusIcon(status: SessionState['status']): string {
  switch (status) {
    case 'running': return chalk.green('●');
    case 'completed': return chalk.green('✓');
    case 'failed': return chalk.red('✗');
    case 'paused': return chalk.yellow('○');
    case 'waiting-for-user': return chalk.yellow('⏳');
    default: return '·';
  }
}

function statusText(s: SessionState): string {
  switch (s.status) {
    case 'running': return chalk.green(`Running · Step ${s.currentStep}/${s.maxSteps}${s.domain ? ` · ${s.domain}` : ''}`);
    case 'completed': return chalk.green(`Completed${s.result ? ` · ${truncate(s.result, 30)}` : ''}`);
    case 'failed': return chalk.red(`Failed${s.result ? ` · ${truncate(s.result, 30)}` : ''}`);
    case 'paused': return chalk.yellow('Paused');
    case 'waiting-for-user': return chalk.yellow('Waiting for user');
    default: return '';
  }
}

export function renderDashboard(renderer: Renderer, state: AppState): void {
  const content: string[] = [];

  content.push('');
  content.push(chalk.bold.cyan('  brmonk') + chalk.gray(' — AI Browser Agent'));
  content.push('');

  // Sessions list
  if (state.sessions.length === 0) {
    content.push(chalk.gray('  No sessions yet. Press [n] to start a new task.'));
    content.push('');
  } else {
    content.push(chalk.bold('  Sessions'));
    content.push('');
    for (let i = 0; i < state.sessions.length; i++) {
      const s = state.sessions[i];
      if (!s) continue;
      const selected = i === state.activeSessionIndex;
      const prefix = selected ? chalk.cyan('  ▸ ') : '    ';
      const icon = statusIcon(s.status);
      const taskStr = truncate(s.task, renderer.getWidth() - 20);
      content.push(`${prefix}${icon} ${selected ? chalk.white.bold(taskStr) : taskStr}`);
      content.push(`${selected ? '      ' : '      '}${statusText(s)}`);
    }
    content.push('');
  }

  // Profile sidebar info
  if (state.profile) {
    content.push(chalk.gray('  ─'.repeat(20)));
    content.push(`  ${chalk.bold('Profile')}: ${state.profile.name}`);
    content.push(`  ${chalk.gray('Skills')}: ${state.profile.skills} · ${chalk.gray('Exp')}: ${state.profile.experience} positions`);
    content.push(`  ${chalk.gray('Jobs tracked')}: ${state.profile.jobCount}`);
    content.push('');
  }

  if (state.memoryCount > 0) {
    content.push(chalk.gray(`  Memory: ${state.memoryCount} entries`));
    content.push('');
  }

  // Footer
  content.push(chalk.gray('  [n] New session  [Enter] Open session  [p] Profile  [q] Quit'));

  const lines = renderer.drawBox('brmonk', content, { borderColor: 'cyan', titleColor: 'cyan' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}
