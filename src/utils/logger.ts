import chalk from 'chalk';

let verboseMode = false;

export function setVerbose(v: boolean): void {
  verboseMode = v;
}

export const logger = {
  thought(message: string): void {
    console.log(chalk.cyan(`[agent] ${message}`));
  },

  action(message: string): void {
    console.log(chalk.yellow(`[browser] ${message}`));
  },

  success(message: string): void {
    console.log(chalk.green(`[success] ${message}`));
  },

  error(message: string): void {
    console.log(chalk.red(`[error] ${message}`));
  },

  plan(message: string): void {
    console.log(chalk.blue(`[plan] ${message}`));
  },

  tool(name: string, args: Record<string, unknown>): void {
    const argStr = Object.entries(args)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    console.log(chalk.magenta(`[tool] ${name}(${argStr})`));
  },

  info(message: string): void {
    console.log(chalk.white(`[info] ${message}`));
  },

  debug(message: string): void {
    if (verboseMode) {
      console.log(chalk.gray(`[debug] ${message}`));
    }
  },

  spinner(message: string): { stop: () => void } {
    const frames = ['|', '/', '-', '\\'];
    let i = 0;
    const interval = setInterval(() => {
      process.stdout.write(`\r${chalk.cyan(frames[i % frames.length])} ${message}`);
      i++;
    }, 100);

    return {
      stop(): void {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(message.length + 4) + '\r');
      },
    };
  },
};
