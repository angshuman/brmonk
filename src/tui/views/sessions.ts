import chalk from 'chalk';
import { Renderer, truncate } from '../renderer.js';
import type { SessionResult } from '../../memory/types.js';

function statusColor(status: SessionResult['status']): (s: string) => string {
  switch (status) {
    case 'completed': return chalk.green;
    case 'failed': return chalk.red;
    case 'max-steps': return chalk.yellow;
  }
}

function statusLabel(status: SessionResult['status']): string {
  return statusColor(status)(status);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const hour = d.getHours();
  const min = d.getMinutes().toString().padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${month} ${day}, ${h12}:${min} ${ampm}`;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export function renderSessionsList(
  renderer: Renderer,
  sessions: SessionResult[],
  selectedIndex: number,
): void {
  const content: string[] = [];

  content.push('');
  content.push(chalk.bold.cyan('  Session History'));
  content.push('');

  if (sessions.length === 0) {
    content.push(chalk.gray('  No past sessions found.'));
    content.push('');
  } else {
    const viewportHeight = renderer.getHeight() - 8;
    const visibleCount = Math.max(1, Math.floor(viewportHeight / 2));
    let startIdx = 0;
    if (selectedIndex >= visibleCount) {
      startIdx = selectedIndex - visibleCount + 1;
    }
    const endIdx = Math.min(sessions.length, startIdx + visibleCount);

    for (let i = startIdx; i < endIdx; i++) {
      const s = sessions[i];
      if (!s) continue;
      const selected = i === selectedIndex;
      const prefix = selected ? chalk.cyan('  ▸ ') : '    ';
      const taskStr = truncate(s.task, renderer.getWidth() - 30);
      const dateStr = chalk.dim(formatDate(s.completedAt));
      const stepsStr = chalk.dim(`${s.steps} steps`);

      content.push(`${prefix}${selected ? chalk.white.bold(taskStr) : taskStr}`);
      content.push(`      ${statusLabel(s.status)}  ${dateStr}  ${stepsStr}`);
    }

    if (sessions.length > visibleCount) {
      content.push('');
      content.push(chalk.dim(`  Showing ${startIdx + 1}-${endIdx} of ${sessions.length}`));
    }
    content.push('');
  }

  content.push(chalk.gray('  [↑/↓] Navigate  [Enter] View details  [Esc/b] Back'));

  const lines = renderer.drawBox('Sessions', content, { borderColor: 'cyan', titleColor: 'cyan' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}

export function renderSessionDetail(
  renderer: Renderer,
  session: SessionResult,
  scrollOffset: number,
): void {
  const content: string[] = [];
  const w = renderer.getWidth() - 8;

  content.push('');
  content.push(`  ${chalk.bold('Task')}`);

  // Word-wrap the task text
  const taskLines = wordWrap(session.task, w);
  for (const line of taskLines) {
    content.push(`  ${line}`);
  }

  content.push('');
  content.push(`  ${chalk.bold('Status')}: ${statusLabel(session.status)}`);
  content.push(`  ${chalk.bold('Duration')}: ${formatDuration(session.startedAt, session.completedAt)}`);
  content.push(`  ${chalk.bold('Steps')}: ${session.steps}`);
  content.push(`  ${chalk.bold('Started')}: ${chalk.dim(formatDate(session.startedAt))}`);
  content.push(`  ${chalk.bold('Completed')}: ${chalk.dim(formatDate(session.completedAt))}`);

  if (session.toolsUsed.length > 0) {
    content.push('');
    content.push(`  ${chalk.bold('Tools Used')}`);
    const toolsStr = session.toolsUsed.join(', ');
    const toolLines = wordWrap(toolsStr, w);
    for (const line of toolLines) {
      content.push(`  ${chalk.dim(line)}`);
    }
  }

  if (session.urls && session.urls.length > 0) {
    content.push('');
    content.push(`  ${chalk.bold('URLs Visited')}`);
    for (const url of session.urls) {
      content.push(`  ${chalk.dim(truncate(url, w))}`);
    }
  }

  content.push('');
  content.push(`  ${chalk.bold('Result')}`);
  const resultLines = wordWrap(session.result || '(no result)', w);
  for (const line of resultLines) {
    content.push(`  ${line}`);
  }

  content.push('');
  content.push(chalk.gray('  [Esc/b] Back to sessions list'));

  // Apply scroll offset
  const viewportHeight = renderer.getHeight() - 4;
  const displayLines = content.slice(scrollOffset, scrollOffset + viewportHeight);

  const lines = renderer.drawBox('Session Detail', displayLines, { borderColor: 'cyan', titleColor: 'cyan' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}

function wordWrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
      continue;
    }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 > width && current.length > 0) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}
