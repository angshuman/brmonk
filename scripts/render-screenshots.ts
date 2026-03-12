/**
 * Renders mock TUI screens to stdout for screenshot capture.
 * Usage: npx tsx scripts/render-screenshots.ts <view>
 * Views: dashboard, session, input, action-required
 */
import chalk from 'chalk';

// Force chalk colors even when piped
chalk.level = 3;

const W = 88;

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function colorBorder(s: string, color: string): string {
  switch (color) {
    case 'green': return chalk.green(s);
    case 'red': return chalk.red(s);
    case 'yellow': return chalk.yellow(s);
    case 'cyan': return chalk.cyan(s);
    default: return chalk.gray(s);
  }
}

function colorTitle(s: string, color: string): string {
  switch (color) {
    case 'green': return chalk.green(s);
    case 'cyan': return chalk.cyan(s);
    case 'white': return chalk.white.bold(s);
    case 'yellow': return chalk.yellow(s);
    default: return chalk.cyan(s);
  }
}

function drawBox(title: string, content: string[], borderColor = 'gray', titleColor = 'cyan'): string[] {
  const w = W - 2;
  const lines: string[] = [];
  const titleStr = title ? ` ${title} ` : '';
  lines.push(
    colorBorder('╭─', borderColor) +
    colorTitle(titleStr, titleColor) +
    colorBorder('─'.repeat(Math.max(0, w - titleStr.length - 2)) + '╮', borderColor)
  );
  for (const line of content) {
    const stripped = stripAnsi(line);
    const padLen = Math.max(0, w - stripped.length);
    lines.push(
      colorBorder('│', borderColor) + ' ' + line + ' '.repeat(padLen > 0 ? padLen - 1 : 0) + colorBorder('│', borderColor)
    );
  }
  lines.push(colorBorder('╰' + '─'.repeat(Math.max(0, w)) + '╯', borderColor));
  return lines;
}

function renderDashboard(): void {
  const content: string[] = [];
  content.push('');
  content.push(chalk.bold.cyan('  🧘 brmonk') + chalk.gray(' — AI Browser Agent'));
  content.push('');
  content.push(chalk.bold('  Sessions'));
  content.push('');

  // Session 1 - running
  content.push(chalk.cyan('  ▸ ') + chalk.green('●') + ' ' + chalk.white.bold('Search for Senior React jobs on LinkedIn'));
  content.push('      ' + chalk.green('Running · Step 12/50 · linkedin.com'));
  // Session 2 - completed
  content.push('    ' + chalk.green('✓') + ' Extract pricing data from competitor websites');
  content.push('      ' + chalk.green('Completed · Found 24 pricing tiers across 5 sites'));
  // Session 3 - failed
  content.push('    ' + chalk.red('✗') + ' Fill out application on workday.com');
  content.push('      ' + chalk.red('Failed · CAPTCHA timeout after 3 attempts'));
  // Session 4 - paused
  content.push('    ' + chalk.yellow('○') + ' Monitor Hacker News for AI agent discussions');
  content.push('      ' + chalk.yellow('Paused'));
  content.push('');
  content.push(chalk.gray('  ─').repeat(10));
  content.push(`  ${chalk.bold('Profile')}: Alex Chen`);
  content.push(`  ${chalk.gray('Skills')}: 12 · ${chalk.gray('Exp')}: 3 positions · ${chalk.gray('Jobs tracked')}: 47`);
  content.push('');
  content.push(chalk.gray('  Memory: 83 entries'));
  content.push('');
  content.push(chalk.gray('  [n] New session  [↑↓/jk] Navigate  [Enter] Open  [p] Profile  [q] Quit'));

  const lines = drawBox('brmonk', content, 'cyan', 'cyan');
  console.log(lines.join('\n'));
}

function renderSession(): void {
  const content: string[] = [];
  content.push('');
  // Plan
  content.push(chalk.bold('  📋 Plan'));
  content.push(`  ${chalk.green('✓')} 1. Navigate to LinkedIn Jobs`);
  content.push(`  ${chalk.green('✓')} 2. Search for "Senior React Developer"`);
  content.push(`  ${chalk.green('✓')} 3. Dismiss cookie consent and popups`);
  content.push(`  ${chalk.yellow('→')} 4. Extract job listings from search results`);
  content.push(`  ${chalk.gray(' ')} 5. Analyze each listing against resume`);
  content.push(`  ${chalk.gray(' ')} 6. Save top matches and present results`);
  content.push('');
  // Status
  content.push(`  ${chalk.bold('Status')}: ${chalk.green('running')} · ${chalk.gray('Step 12/50')} · ${chalk.gray('2m 34s')} · ${chalk.gray('18.2K tokens')}`);
  content.push('');
  // Log
  content.push(chalk.bold('  Agent Log'));
  content.push(`  · ${chalk.gray('Navigated to linkedin.com/jobs')}`);
  content.push(`  · ${chalk.gray('Popup dismissed: Cookie consent')}`);
  content.push(`  ⚡ ${chalk.cyan('type(index=5, text="Senior React Developer San Francisco")')}`);
  content.push(`  → ${chalk.white('Typed text into search field')}`);
  content.push(`  ⚡ ${chalk.cyan('click(index=6)')}`);
  content.push(`  → ${chalk.white('Clicked search button, 47 results loaded')}`);
  content.push(`  💭 ${chalk.gray('Found 47 results. Extracting details from each listing...')}`);
  content.push(`  ⚡ ${chalk.cyan('click(index=12)')}`);
  content.push(`  → ${chalk.white('Opened: "Sr. React Engineer — Stripe" ')}`);
  content.push(`  💭 ${chalk.gray('Good match: requires React, TypeScript, Node. Saving...')}`);
  content.push(`  ⚡ ${chalk.cyan('click(index=15)')}`);
  content.push(`  → ${chalk.white('Opened: "Senior Frontend — Vercel"')}`);
  content.push('');
  // Current action
  content.push(`  ${chalk.yellow('⏳')} ${chalk.yellow('extractText() → analyzing job requirements...')}`);
  content.push('');
  content.push(chalk.gray('  [m] Send message  [p] Pause  [s] Screenshot  [b] Back  [Esc] Dashboard'));

  const lines = drawBox('Session: Search for Senior React jobs on LinkedIn ─── Step 12/50', content, 'green', 'white');
  console.log(lines.join('\n'));
}

function renderInput(): void {
  const content: string[] = [];
  content.push('');
  content.push(chalk.bold('  What would you like me to do?'));
  content.push('');
  content.push(`  ${chalk.cyan('>')} Search for senior React developer jobs in San Francisco on`);
  content.push(`    LinkedIn and Indeed, compare them against my resume, and`);
  content.push(`    save the top 10 matches${chalk.gray('█')}`);
  content.push('');
  content.push(chalk.gray('  Suggestions:'));
  content.push(chalk.gray('  · Search for jobs matching my profile'));
  content.push(chalk.gray('  · Fill out a job application'));
  content.push(chalk.gray('  · Research companies from my job list'));
  content.push(chalk.gray('  · Import my resume'));
  content.push('');
  content.push(chalk.gray('  [Enter] Submit  [Esc] Cancel'));

  const lines = drawBox('New Session', content, 'cyan', 'cyan');
  console.log(lines.join('\n'));
}

function renderActionRequired(): void {
  const content: string[] = [];
  content.push('');
  content.push(`  🔐 ${chalk.bold.yellow('Login Required — linkedin.com')}`);
  content.push('');
  content.push('  The agent needs you to log in to LinkedIn to continue.');
  content.push('  Please switch to the browser window and sign in.');
  content.push('');
  content.push(chalk.gray('  The browser window is open and waiting.'));
  content.push(chalk.gray('  The agent will automatically continue once you\'re done.'));
  content.push('');
  content.push(chalk.gray('  [Enter] I\'m done, continue  [s] Skip this step  [q] Cancel task'));

  const lines = drawBox('⚠ Action Required', content, 'yellow', 'yellow');
  console.log(lines.join('\n'));
}

function renderCLI(): void {
  console.log(chalk.gray('$ ') + chalk.white('brmonk run "Go to hacker news and get the top 5 stories"'));
  console.log('');
  console.log(chalk.cyan('🤖') + chalk.gray(' Using claude provider'));
  console.log(chalk.cyan('🤖') + chalk.gray(' Task: Go to hacker news and get the top 5 stories'));
  console.log(chalk.blue('📋') + chalk.gray(' Plan: 1) Navigate to HN  2) Extract stories  3) Return results'));
  console.log('');
  console.log(chalk.cyan('🤖') + chalk.gray(' Step 1/50'));
  console.log(chalk.yellow('🌐') + chalk.gray(' goTo: Navigated to https://news.ycombinator.com'));
  console.log(chalk.cyan('🤖') + chalk.gray(' Step 2/50'));
  console.log(chalk.magenta('🔧') + chalk.gray(' evaluate: Extracting story titles and URLs...'));
  console.log(chalk.cyan('🤖') + chalk.gray(' Step 3/50'));
  console.log(chalk.green('✅') + chalk.gray(' Task completed'));
  console.log('');
  console.log(chalk.white('Top 5 Hacker News Stories:'));
  console.log(chalk.white('1. Show HN: I built an AI browser agent in TypeScript'));
  console.log(chalk.white('   https://news.ycombinator.com/item?id=42901234'));
  console.log(chalk.white('2. The hidden costs of LLM-powered automation'));
  console.log(chalk.white('   https://news.ycombinator.com/item?id=42901198'));
  console.log(chalk.white('3. Playwright vs Puppeteer in 2026: A comprehensive benchmark'));
  console.log(chalk.white('   https://news.ycombinator.com/item?id=42901087'));
  console.log(chalk.white('4. Why browser agents are the next platform shift'));
  console.log(chalk.white('   https://news.ycombinator.com/item?id=42900956'));
  console.log(chalk.white('5. Ask HN: What tools do you use for web scraping?'));
  console.log(chalk.white('   https://news.ycombinator.com/item?id=42900871'));
}

const view = process.argv[2] ?? 'dashboard';
switch (view) {
  case 'dashboard': renderDashboard(); break;
  case 'session': renderSession(); break;
  case 'input': renderInput(); break;
  case 'action': renderActionRequired(); break;
  case 'cli': renderCLI(); break;
  default:
    console.error(`Unknown view: ${view}`);
    process.exit(1);
}
