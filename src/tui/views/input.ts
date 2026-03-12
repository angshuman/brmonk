import chalk from 'chalk';
import { Renderer } from '../renderer.js';
import type { AppState } from '../state.js';

const SUGGESTIONS = [
  'Search for listings matching my requirements',
  'Track items from this page',
  'Compare saved items against my documents',
  'Import a document',
];

function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxWidth) {
    let breakAt = remaining.lastIndexOf(' ', maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export function renderInput(renderer: Renderer, state: AppState): void {
  const content: string[] = [];

  content.push('');
  content.push(chalk.bold('  What would you like me to do?'));
  content.push('');

  const inputWidth = renderer.getWidth() - 8;
  const wrappedLines = wrapText(state.inputBuffer, inputWidth);
  if (wrappedLines.length === 0) {
    content.push(`  ${chalk.cyan('>')} ${chalk.gray('█')}`);
  } else {
    for (let i = 0; i < wrappedLines.length; i++) {
      const prefix = i === 0 ? `  ${chalk.cyan('>')} ` : '    ';
      const cursor = i === wrappedLines.length - 1 ? chalk.gray('█') : '';
      content.push(`${prefix}${wrappedLines[i]}${cursor}`);
    }
  }

  content.push('');
  content.push(chalk.gray('  Suggestions:'));
  for (const suggestion of SUGGESTIONS) {
    content.push(chalk.gray(`  · ${suggestion}`));
  }
  content.push('');
  content.push(chalk.gray('  [Enter] Submit  [Esc] Cancel'));

  const lines = renderer.drawBox('New Session', content, { borderColor: 'cyan', titleColor: 'cyan' });
  for (const line of lines) {
    renderer.writeLine(line);
  }
}
