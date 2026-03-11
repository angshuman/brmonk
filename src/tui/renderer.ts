import chalk from 'chalk';

export interface BoxStyle {
  borderColor?: string;
  titleColor?: string;
}

export class Renderer {
  private width: number;
  private height: number;
  private buffer: string[] = [];

  constructor() {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
  }

  refresh(): void {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  clear(): void {
    this.buffer = [];
    process.stdout.write('\x1b[2J\x1b[H');
  }

  moveTo(row: number, col: number): void {
    process.stdout.write(`\x1b[${row};${col}H`);
  }

  hideCursor(): void {
    process.stdout.write('\x1b[?25l');
  }

  showCursor(): void {
    process.stdout.write('\x1b[?25h');
  }

  writeLine(text: string): void {
    this.buffer.push(text);
  }

  writeEmptyLine(): void {
    this.buffer.push('');
  }

  drawBox(title: string, content: string[], style?: BoxStyle): string[] {
    const w = this.width - 2;
    const borderColor = style?.borderColor ?? 'gray';
    const titleColor = style?.titleColor ?? 'cyan';
    const lines: string[] = [];

    const colorBorder = (s: string): string => {
      switch (borderColor) {
        case 'green': return chalk.green(s);
        case 'red': return chalk.red(s);
        case 'yellow': return chalk.yellow(s);
        case 'cyan': return chalk.cyan(s);
        case 'magenta': return chalk.magenta(s);
        default: return chalk.gray(s);
      }
    };

    const colorTitle = (s: string): string => {
      switch (titleColor) {
        case 'green': return chalk.green(s);
        case 'red': return chalk.red(s);
        case 'yellow': return chalk.yellow(s);
        case 'cyan': return chalk.cyan(s);
        case 'white': return chalk.white(s);
        default: return chalk.cyan(s);
      }
    };

    // Top border with title
    const titleStr = title ? ` ${title} ` : '';
    const topLine = colorBorder('╭─') + colorTitle(titleStr) + colorBorder('─'.repeat(Math.max(0, w - titleStr.length - 2)) + '╮');
    lines.push(topLine);

    // Content lines
    for (const line of content) {
      const stripped = stripAnsi(line);
      const padLen = Math.max(0, w - stripped.length);
      lines.push(colorBorder('│') + ' ' + line + ' '.repeat(padLen > 0 ? padLen - 1 : 0) + colorBorder('│'));
    }

    // Bottom border
    lines.push(colorBorder('╰' + '─'.repeat(Math.max(0, w)) + '╯'));

    return lines;
  }

  drawProgressBar(width: number, progress: number): string {
    const filled = Math.round(width * Math.min(1, Math.max(0, progress)));
    const empty = width - filled;
    return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  drawDivider(): string {
    return chalk.gray('─'.repeat(this.width - 4));
  }

  flush(): void {
    process.stdout.write('\x1b[H');
    const output = this.buffer.join('\n');
    process.stdout.write(output);
    process.stdout.write('\x1b[J');
    this.buffer = [];
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function truncate(str: string, maxLen: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxLen) return str;
  // For strings with ANSI, just truncate the stripped version
  return stripped.slice(0, maxLen - 1) + '…';
}

export function padRight(str: string, len: number): string {
  const stripped = stripAnsi(str);
  const padLen = Math.max(0, len - stripped.length);
  return str + ' '.repeat(padLen);
}
