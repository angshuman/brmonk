#!/usr/bin/env node

import { Command } from 'commander';
import * as readline from 'node:readline';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { loadConfig, saveConfig, showConfig, type Config } from './config.js';
import { createProvider, type ProviderName } from './llm/provider.js';
import { BrowserEngine } from './browser/engine.js';
import { AgentLoop } from './agent/loop.js';
import { SkillRegistry } from './skills/registry.js';
import { MemoryStore } from './memory/store.js';
import { AgentEventBus } from './events.js';
import { TUIApp } from './tui/app.js';
import { logger, setVerbose } from './utils/logger.js';

const program = new Command();

program
  .name('brmonk')
  .description('AI-powered browser automation agent')
  .version('1.0.0')
  .action(async () => {
    // Default action (no subcommand) — launch TUI dashboard
    try {
      const config = await loadConfig();
      const provider = createProvider(config.provider, config.model || undefined);
      const browser = new BrowserEngine(config.headless, config.persistBrowserContext);
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);

      await skillRegistry.loadFromDirectory(config.skillsDir);
      await browser.launch();

      const cleanup = async (): Promise<void> => {
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      const app = new TUIApp({
        browser,
        llm: provider,
        skillRegistry,
        memory,
        maxSteps: config.maxSteps,
      });

      await app.start();
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('run')
  .description('Run a single browser automation task')
  .argument('<task>', 'Task description')
  .option('-p, --provider <provider>', 'LLM provider (claude, openai, grok, auto)')
  .option('-m, --model <model>', 'Model name')
  .option('--headful', 'Show the browser window')
  .option('--headless', 'Run browser in headless mode')
  .option('--max-steps <steps>', 'Maximum steps', parseInt)
  .option('--skills <skills>', 'Comma-separated list of skills to enable')
  .option('-v, --verbose', 'Verbose output')
  .action(async (task: string, opts: Record<string, unknown>) => {
    try {
      const cliOverrides: Partial<Config> = {};
      if (opts['provider']) cliOverrides.provider = opts['provider'] as ProviderName;
      if (opts['model']) cliOverrides.model = opts['model'] as string;
      if (opts['headful']) cliOverrides.headless = false;
      if (opts['headless']) cliOverrides.headless = true;
      if (opts['maxSteps']) cliOverrides.maxSteps = opts['maxSteps'] as number;
      if (opts['verbose']) cliOverrides.verbose = true;

      const config = await loadConfig(cliOverrides);
      if (config.verbose) setVerbose(true);

      const provider = createProvider(config.provider, config.model || undefined);
      const browser = new BrowserEngine(config.headless, config.persistBrowserContext);
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);
      const eventBus = new AgentEventBus();

      // Load user skills
      await skillRegistry.loadFromDirectory(config.skillsDir);

      // Launch browser
      await browser.launch();

      // Setup graceful shutdown
      const cleanup = async (): Promise<void> => {
        logger.info('Shutting down...');
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      // Run agent
      const agent = new AgentLoop({
        llm: provider,
        browser,
        skillRegistry,
        memory,
        eventBus,
        maxSteps: config.maxSteps,
      });

      logger.info(`Using ${provider.name} provider`);
      logger.info(`Task: ${task}`);

      const state = await agent.run(task);

      // Save session
      const sessionId = crypto.randomUUID().slice(0, 8);
      await memory.saveSession(sessionId, state.history, task);

      if (state.status === 'completed') {
        logger.success(`Result: ${state.result}`);
        console.log(`\n${state.result}`);
      } else {
        logger.error(`Failed: ${state.result}`);
        process.exitCode = 1;
      }

      await browser.close();
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('interactive')
  .description('Start interactive mode (REPL)')
  .option('-p, --provider <provider>', 'LLM provider')
  .option('-m, --model <model>', 'Model name')
  .option('--headful', 'Show the browser window')
  .option('-v, --verbose', 'Verbose output')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cliOverrides: Partial<Config> = {};
      if (opts['provider']) cliOverrides.provider = opts['provider'] as ProviderName;
      if (opts['model']) cliOverrides.model = opts['model'] as string;
      if (opts['headful']) cliOverrides.headless = false;
      if (opts['verbose']) cliOverrides.verbose = true;

      const config = await loadConfig(cliOverrides);
      if (config.verbose) setVerbose(true);

      const provider = createProvider(config.provider, config.model || undefined);
      const browser = new BrowserEngine(config.headless, config.persistBrowserContext);
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);
      const eventBus = new AgentEventBus();

      await skillRegistry.loadFromDirectory(config.skillsDir);
      await browser.launch();

      const cleanup = async (): Promise<void> => {
        logger.info('Shutting down...');
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      const agent = new AgentLoop({
        llm: provider,
        browser,
        skillRegistry,
        memory,
        eventBus,
        maxSteps: config.maxSteps,
      });

      logger.info(`brmonk interactive mode (${provider.name})`);
      logger.info('Type a task or use /help for commands. /quit to exit.\n');

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'brmonk> ',
      });

      rl.prompt();

      rl.on('line', (line: string) => {
        const input = line.trim();
        if (!input) {
          rl.prompt();
          return;
        }

        // Handle commands
        if (input.startsWith('/')) {
          void (async () => {
            switch (input.split(' ')[0]) {
              case '/quit':
              case '/exit':
                await cleanup();
                break;

              case '/help':
                console.log(`
Commands:
  /help       - Show this help message
  /quit       - Exit interactive mode
  /clear      - Clear the conversation history
  /skills     - List available skills
  /screenshot - Take a screenshot of the current page
  /history    - Show session history

Or type any task to execute it.
`);
                break;

              case '/clear':
                logger.info('Conversation cleared');
                break;

              case '/skills':
                console.log('\nAvailable skills:');
                for (const skill of skillRegistry.listSkills()) {
                  console.log(`  ${skill.name} (v${skill.version}) - ${skill.description}`);
                }
                console.log('');
                break;

              case '/screenshot': {
                try {
                  const page = browser.currentPage();
                  const screenshotPath = `/tmp/brmonk-screenshot-${Date.now()}.png`;
                  await page.screenshot({ path: screenshotPath });
                  logger.success(`Screenshot saved to ${screenshotPath}`);
                } catch (err) {
                  logger.error(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                break;
              }

              case '/history': {
                const sessions = await memory.listSessions();
                if (sessions.length === 0) {
                  logger.info('No session history.');
                } else {
                  console.log('\nRecent sessions:');
                  for (const s of sessions.slice(0, 10)) {
                    const date = new Date(s.timestamp).toLocaleString();
                    console.log(`  [${s.id}] ${date} - ${s.task}`);
                  }
                  console.log('');
                }
                break;
              }

              default:
                logger.error(`Unknown command: ${input}`);
            }
            rl.prompt();
          })();
          return;
        }

        // Run task
        void (async () => {
          const state = await agent.run(input);
          const sessionId = crypto.randomUUID().slice(0, 8);
          await memory.saveSession(sessionId, state.history, input);

          if (state.status === 'completed') {
            logger.success(`Result: ${state.result}`);
          } else {
            logger.error(`Failed: ${state.result}`);
          }
          console.log('');
          rl.prompt();
        })();
      });

      rl.on('close', () => {
        void cleanup();
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

const skillsCmd = program
  .command('skills')
  .description('Manage skills');

skillsCmd
  .command('list')
  .description('List available skills')
  .action(async () => {
    try {
      const config = await loadConfig();
      const registry = new SkillRegistry();
      await registry.loadFromDirectory(config.skillsDir);

      console.log('\nAvailable skills:');
      for (const skill of registry.listSkills()) {
        console.log(`  ${skill.name} (v${skill.version})`);
        console.log(`    ${skill.description}`);
        console.log(`    Tools: ${skill.tools.map(t => t.name).join(', ')}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

const historyCmd = program
  .command('history')
  .description('View session history');

historyCmd
  .command('list')
  .description('List recent sessions')
  .action(async () => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const sessions = await memory.listSessions();

      if (sessions.length === 0) {
        logger.info('No session history.');
        return;
      }

      console.log('\nRecent sessions:');
      for (const s of sessions) {
        const date = new Date(s.timestamp).toLocaleString();
        console.log(`  [${s.id}] ${date} - ${s.task}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

historyCmd
  .command('show')
  .description('Show session details')
  .argument('<id>', 'Session ID')
  .action(async (id: string) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const steps = await memory.loadSession(id);

      if (!steps) {
        logger.error(`Session '${id}' not found`);
        process.exitCode = 1;
        return;
      }

      console.log(`\nSession: ${id}`);
      console.log(`Steps: ${steps.length}\n`);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        console.log(`--- Step ${i + 1} ---`);
        if (step.reasoning) console.log(`Reasoning: ${step.reasoning}`);
        for (const action of step.actions) {
          console.log(`  Action: ${action.name}(${JSON.stringify(action.args)})`);
          console.log(`  Result: ${action.result}`);
        }
        console.log('');
      }
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// Profile commands
const profileCmd = program
  .command('profile')
  .description('Manage user profile');

profileCmd
  .command('show')
  .description('Show current profile')
  .action(async () => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const profile = await memory.getProfile();

      if (!profile) {
        logger.info('No profile set. Use `brmonk profile set` or `brmonk profile import <file>` to create one.');
        return;
      }

      console.log('\nProfile:');
      console.log(`  Name: ${profile.name}`);
      console.log(`  Email: ${profile.email}`);
      if (profile.phone) console.log(`  Phone: ${profile.phone}`);
      if (profile.location) console.log(`  Location: ${profile.location}`);
      if (profile.summary) console.log(`  Summary: ${profile.summary}`);
      if (profile.skills.length > 0) console.log(`  Skills: ${profile.skills.join(', ')}`);
      if (profile.experience.length > 0) {
        console.log('  Experience:');
        for (const exp of profile.experience) {
          console.log(`    - ${exp.title} at ${exp.company} (${exp.startDate}${exp.endDate ? ` - ${exp.endDate}` : ' - present'})`);
        }
      }
      if (profile.education.length > 0) {
        console.log('  Education:');
        for (const edu of profile.education) {
          console.log(`    - ${edu.degree} in ${edu.field}, ${edu.institution} (${edu.year})`);
        }
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

profileCmd
  .command('set')
  .description('Set profile info interactively')
  .action(async () => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = (prompt: string): Promise<string> =>
        new Promise(resolve => rl.question(prompt, resolve));

      const name = await ask('Name: ');
      const email = await ask('Email: ');
      const phone = await ask('Phone (optional): ');
      const location = await ask('Location (optional): ');
      const skillsStr = await ask('Skills (comma-separated): ');
      const summary = await ask('Professional summary (optional): ');

      rl.close();

      const skills = skillsStr.split(',').map(s => s.trim()).filter(Boolean);

      await memory.saveProfile({
        name,
        email,
        phone: phone || undefined,
        location: location || undefined,
        summary: summary || undefined,
        skills,
      });

      logger.success('Profile saved!');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

profileCmd
  .command('import')
  .description('Import resume from a text file')
  .argument('<file>', 'Path to resume text file')
  .action(async (filePath: string) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);

      let text: string;
      try {
        text = await fs.readFile(filePath, 'utf-8');
      } catch {
        logger.error(`Cannot read file: ${filePath}`);
        process.exitCode = 1;
        return;
      }

      if (!text.trim()) {
        logger.error('File is empty');
        process.exitCode = 1;
        return;
      }

      // Save raw resume text, profile parsing requires LLM which we don't have in CLI-only mode
      await memory.saveResume(text);
      logger.success(`Resume imported from ${filePath} (${text.length} chars)`);
      logger.info('To parse it into a structured profile, run a task like "Parse my resume" in interactive mode.');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// Jobs commands
const jobsCmd = program
  .command('jobs')
  .description('Manage tracked jobs');

jobsCmd
  .command('list')
  .description('List tracked jobs')
  .option('--status <status>', 'Filter by status (new, applied, saved, rejected)')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const filters = opts['status'] ? { status: opts['status'] as string } : undefined;
      const jobs = await memory.getJobs(filters as Record<string, string> | undefined);

      if (jobs.length === 0) {
        logger.info('No tracked jobs. Use job-search skill to find and save jobs.');
        return;
      }

      console.log(`\nTracked Jobs (${jobs.length}):`);
      for (const job of jobs) {
        const score = job.matchScore !== undefined ? ` [${job.matchScore}%]` : '';
        console.log(`  [${job.status}]${score} ${job.title} at ${job.company}`);
        console.log(`    Location: ${job.location}`);
        if (job.salary) console.log(`    Salary: ${job.salary}`);
        console.log(`    URL: ${job.url}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

jobsCmd
  .command('match')
  .description('Match tracked jobs against your profile')
  .action(async () => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const matches = await memory.matchJobsToProfile();

      if (matches.length === 0) {
        logger.info('No matches. Make sure you have a profile and tracked jobs.');
        return;
      }

      console.log(`\nJob Matches (${matches.length}):`);
      for (const match of matches) {
        console.log(`\n  ${match.job.title} at ${match.job.company} — ${match.score}% match`);
        if (match.matchedSkills.length > 0) {
          console.log(`    Matched: ${match.matchedSkills.join(', ')}`);
        }
        if (match.missingSkills.length > 0) {
          console.log(`    Missing: ${match.missingSkills.join(', ')}`);
        }
        console.log(`    ${match.reasoning}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

const configCmd = program
  .command('config')
  .description('Manage configuration');

configCmd
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key')
  .argument('<value>', 'Configuration value')
  .action(async (key: string, value: string) => {
    try {
      await saveConfig(key, value);
      logger.success(`Set ${key} = ${value}`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    try {
      const config = await showConfig();
      console.log('\nCurrent configuration:');
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program.parse();
