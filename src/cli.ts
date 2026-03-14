#!/usr/bin/env node

import { Command } from 'commander';
import * as readline from 'node:readline';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig, showConfig, type Config } from './config.js';
import { createProvider, type ProviderName } from './llm/provider.js';
import { BrowserEngine } from './browser/engine.js';
import { McpBrowserEngine } from './browser/mcp-engine.js';
import { AgentLoop } from './agent/loop.js';
import { SkillRegistry } from './skills/registry.js';
import { MemoryStore } from './memory/store.js';
import { AgentEventBus } from './events.js';
import { TUIApp } from './tui/app.js';
import { logger, setVerbose } from './utils/logger.js';

/** Initialize browser + MCP engine based on config backend setting */
async function initBrowserBackend(config: Config): Promise<{ browser: BrowserEngine; mcpEngine?: McpBrowserEngine }> {
  let browser: BrowserEngine;
  let mcpEngine: McpBrowserEngine | undefined;

  if (config.browserBackend === 'remote-cdp') {
    const cdpUrl = config.remoteBrowser.cdpUrl;
    if (!cdpUrl) throw new Error('BRMONK_CDP_URL is required for remote-cdp backend');
    browser = new BrowserEngine(config.headless, config.persistBrowserContext, cdpUrl);
    logger.info(`Using remote CDP browser at ${cdpUrl}`);
  } else if (config.browserBackend === 'remote-mcp') {
    const mcpUrl = config.remoteBrowser.mcpUrl;
    if (!mcpUrl) throw new Error('BRMONK_MCP_URL is required for remote-mcp backend');
    browser = new BrowserEngine(config.headless, config.persistBrowserContext);
    mcpEngine = new McpBrowserEngine(config.headless, config.mcpBrowser, mcpUrl);
    await mcpEngine.initialize();
    logger.info(`Using remote MCP browser at ${mcpUrl}`);
  } else if (config.browserBackend === 'playwright-mcp') {
    browser = new BrowserEngine(config.headless, config.persistBrowserContext);
    mcpEngine = new McpBrowserEngine(config.headless, config.mcpBrowser);
    await mcpEngine.initialize();
  } else {
    browser = new BrowserEngine(config.headless, config.persistBrowserContext);
  }

  // Launch browser (skip for remote-mcp — MCP server manages its own browser)
  if (config.browserBackend !== 'remote-mcp') {
    await browser.launch();
  }

  return { browser, mcpEngine };
}

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
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);

      const { browser, mcpEngine } = await initBrowserBackend(config);

      await skillRegistry.loadFromDirectory(config.skillsDir);

      const cleanup = async (): Promise<void> => {
        if (mcpEngine) await mcpEngine.close();
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      const app = new TUIApp({
        browser,
        mcpEngine,
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
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);
      const eventBus = new AgentEventBus();

      const { browser, mcpEngine } = await initBrowserBackend(config);

      // Load user skills
      await skillRegistry.loadFromDirectory(config.skillsDir);

      // Setup graceful shutdown
      const cleanup = async (): Promise<void> => {
        logger.info('Shutting down...');
        if (mcpEngine) await mcpEngine.close();
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      // Run agent
      const agent = new AgentLoop({
        llm: provider,
        browser,
        mcpEngine,
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
      const skillRegistry = new SkillRegistry();
      const memory = new MemoryStore(config.memoryDir);
      const eventBus = new AgentEventBus();

      const { browser, mcpEngine } = await initBrowserBackend(config);

      await skillRegistry.loadFromDirectory(config.skillsDir);

      const cleanup = async (): Promise<void> => {
        logger.info('Shutting down...');
        if (mcpEngine) await mcpEngine.close();
        await browser.close();
        process.exit(0);
      };
      process.on('SIGINT', () => void cleanup());
      process.on('SIGTERM', () => void cleanup());

      const agent = new AgentLoop({
        llm: provider,
        browser,
        mcpEngine,
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

              case '/skills': {
                console.log('\nBuilt-in skills:');
                for (const skill of skillRegistry.listSkills()) {
                  console.log(`  ${skill.name} (v${skill.version}) - ${skill.description}`);
                }
                const richList = skillRegistry.listRichSkills();
                if (richList.length > 0) {
                  console.log('\nUser-defined skills:');
                  for (const skill of richList) {
                    const tags = skill.manifest.tags?.length ? ` [${skill.manifest.tags.join(', ')}]` : '';
                    console.log(`  ${skill.manifest.name} (v${skill.manifest.version})${tags} - ${skill.manifest.description}`);
                  }
                }
                console.log('');
                break;
              }

              case '/screenshot': {
                try {
                  const page = browser.currentPage();
                  const screenshotPath = path.join(os.tmpdir(), `brmonk-screenshot-${Date.now()}.png`);
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
  .description('List all available skills (built-in and user-defined)')
  .action(async () => {
    try {
      const config = await loadConfig();
      const registry = new SkillRegistry();
      await registry.loadFromDirectory(config.skillsDir);

      const counts = registry.getSkillCount();

      console.log(`\nSkills (${counts.total} total):\n`);

      // Built-in skills
      if (counts.builtin > 0) {
        console.log(`  Built-in (${counts.builtin}):`);
        for (const skill of registry.listSkills()) {
          console.log(`    ${skill.name} (v${skill.version})`);
          console.log(`      ${skill.description}`);
          console.log(`      Tools: ${skill.tools.map(t => t.name).join(', ')}`);
        }
      }

      // Rich (YAML) skills
      if (counts.rich > 0) {
        console.log(`\n  User-defined (${counts.rich}):`);
        for (const skill of registry.listRichSkills()) {
          const tags = skill.manifest.tags?.length ? ` [${skill.manifest.tags.join(', ')}]` : '';
          console.log(`    ${skill.manifest.name} (v${skill.manifest.version})${tags}`);
          console.log(`      ${skill.manifest.description}`);
          console.log(`      Tools: ${skill.manifest.tools.map(t => t.name).join(', ')}`);
          if (skill.manifest.author) console.log(`      Author: ${skill.manifest.author}`);
        }
      }

      console.log(`\n  Skills directory: ${config.skillsDir}`);
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

skillsCmd
  .command('info')
  .description('Show detailed information about a skill')
  .argument('<name>', 'Skill name')
  .action(async (name: string) => {
    try {
      const config = await loadConfig();
      const registry = new SkillRegistry();
      await registry.loadFromDirectory(config.skillsDir);

      // Check built-in skills
      const builtin = registry.getSkill(name);
      if (builtin) {
        console.log(`\nSkill: ${builtin.name} (v${builtin.version})`);
        console.log(`Type: built-in`);
        console.log(`Description: ${builtin.description}`);
        console.log(`\nTools:`);
        for (const tool of builtin.tools) {
          console.log(`  ${tool.name}: ${tool.description}`);
        }
        if (builtin.systemPrompt) {
          console.log(`\nSystem Prompt:\n${builtin.systemPrompt}`);
        }
        console.log('');
        return;
      }

      // Check rich skills
      const rich = registry.getRichSkill(name);
      if (rich) {
        const m = rich.manifest;
        console.log(`\nSkill: ${m.name} (v${m.version})`);
        console.log(`Type: user-defined (YAML)`);
        console.log(`Description: ${m.description}`);
        if (m.author) console.log(`Author: ${m.author}`);
        if (m.tags?.length) console.log(`Tags: ${m.tags.join(', ')}`);
        console.log(`Directory: ${rich.skillDir}`);

        console.log(`\nTools:`);
        for (const tool of m.tools) {
          console.log(`  ${tool.name}: ${tool.description}`);
          const action = m.actions[tool.name];
          if (action) {
            console.log(`    Steps: ${action.steps.map(s => s.type).join(' → ')}`);
          }
        }

        if (m.env?.required?.length) {
          console.log(`\nRequired environment variables: ${m.env.required.join(', ')}`);
        }
        if (m.env?.optional?.length) {
          console.log(`Optional environment variables: ${m.env.optional.join(', ')}`);
        }

        console.log(`\nInstructions:\n${m.instructions}`);
        console.log('');
        return;
      }

      logger.error(`Skill "${name}" not found`);
      process.exitCode = 1;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

skillsCmd
  .command('init')
  .description('Create a new skill from a template')
  .argument('<name>', 'Skill name (kebab-case)')
  .action(async (name: string) => {
    try {
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
        logger.error('Skill name must be kebab-case (lowercase letters, numbers, hyphens)');
        process.exitCode = 1;
        return;
      }

      const config = await loadConfig();
      const skillDir = path.join(config.skillsDir, name);

      try {
        await fs.access(skillDir);
        logger.error(`Skill directory already exists: ${skillDir}`);
        process.exitCode = 1;
        return;
      } catch {
        // Good — doesn't exist
      }

      await fs.mkdir(skillDir, { recursive: true });
      await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });

      const yamlContent = `name: ${name}
version: "1.0.0"
description: "TODO: Describe what this skill does"
author: ""
tags: []

instructions: |
  ## ${name}
  TODO: Write instructions that tell the AI when and how to use this skill.
  Include prerequisites, workflow steps, and any important context.

tools:
  - name: exampleTool
    description: "TODO: Describe what this tool does"
    parameters:
      type: object
      properties:
        input:
          type: string
          description: "Example input parameter"
      required: ["input"]

actions:
  exampleTool:
    steps:
      - type: shell
        command: "echo \\"Processing: {{input}}\\""
        timeout: 30
        captureOutput: true

env:
  required: []
  optional: []
`;

      await fs.writeFile(path.join(skillDir, 'skill.yaml'), yamlContent, 'utf-8');

      const readmeContent = `# ${name}

TODO: Document your skill here.

## Installation

\`\`\`bash
cp -r ./${name} ~/.brmonk/skills/
\`\`\`

## Usage

This skill provides the following tools:

- \`exampleTool\`: TODO describe
`;

      await fs.writeFile(path.join(skillDir, 'README.md'), readmeContent, 'utf-8');

      logger.success(`Created skill scaffold at ${skillDir}`);
      console.log(`\nEdit ${path.join(skillDir, 'skill.yaml')} to configure your skill.`);
      console.log('Add scripts to the scripts/ directory as needed.');
      console.log(`Use \`brmonk skills validate ${skillDir}\` to check your skill.\n`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

skillsCmd
  .command('validate')
  .description('Validate a skill definition file')
  .argument('<path>', 'Path to skill.yaml or skill directory')
  .action(async (skillPath: string) => {
    try {
      const { loadRichSkill } = await import('./skills/loader.js');
      const resolvedPath = path.resolve(skillPath);
      const skill = await loadRichSkill(resolvedPath);

      console.log(`\nSkill "${skill.manifest.name}" is valid!`);
      console.log(`  Version: ${skill.manifest.version}`);
      console.log(`  Description: ${skill.manifest.description}`);
      console.log(`  Tools: ${skill.manifest.tools.map(t => t.name).join(', ')}`);
      console.log(`  Actions: ${Object.keys(skill.manifest.actions).join(', ')}`);
      const stepTypes = new Set<string>();
      for (const action of Object.values(skill.manifest.actions)) {
        for (const step of action.steps) {
          stepTypes.add(step.type);
        }
      }
      console.log(`  Step types used: ${Array.from(stepTypes).join(', ')}`);
      console.log('');
    } catch (err) {
      logger.error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

skillsCmd
  .command('install')
  .description('Install a skill from a directory or YAML file')
  .argument('<source>', 'Path to skill directory or .yaml file')
  .action(async (source: string) => {
    try {
      const { loadRichSkill } = await import('./skills/loader.js');
      const resolvedSource = path.resolve(source);

      // Validate first
      const skill = await loadRichSkill(resolvedSource);
      const config = await loadConfig();

      const targetDir = path.join(config.skillsDir, skill.manifest.name);
      await fs.mkdir(config.skillsDir, { recursive: true });

      const stat = await fs.stat(resolvedSource);
      if (stat.isDirectory()) {
        // Copy entire directory
        await copyDir(resolvedSource, targetDir);
      } else {
        // Single file — create a directory for it
        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(resolvedSource, path.join(targetDir, 'skill.yaml'));
      }

      logger.success(`Installed skill "${skill.manifest.name}" to ${targetDir}`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

skillsCmd
  .command('remove')
  .description('Remove a user-installed skill')
  .argument('<name>', 'Skill name')
  .action(async (name: string) => {
    try {
      const config = await loadConfig();
      const skillDir = path.join(config.skillsDir, name);

      try {
        await fs.access(skillDir);
      } catch {
        // Also check for single .yaml file
        const yamlPath = path.join(config.skillsDir, `${name}.yaml`);
        try {
          await fs.access(yamlPath);
          await fs.unlink(yamlPath);
          logger.success(`Removed skill "${name}"`);
          return;
        } catch {
          logger.error(`Skill "${name}" not found in ${config.skillsDir}`);
          process.exitCode = 1;
          return;
        }
      }

      await fs.rm(skillDir, { recursive: true });
      logger.success(`Removed skill "${name}"`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

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
        logger.info('No profile set. Use `brmonk profile set` to create one.');
        return;
      }

      console.log('\nProfile:');
      console.log(`  Name: ${profile.name}`);
      console.log(`  Email: ${profile.email}`);
      if (profile.phone) console.log(`  Phone: ${profile.phone}`);
      if (profile.location) console.log(`  Location: ${profile.location}`);
      if (profile.summary) console.log(`  Summary: ${profile.summary}`);
      if (profile.attributes && Object.keys(profile.attributes).length > 0) {
        console.log('  Attributes:');
        for (const [key, value] of Object.entries(profile.attributes)) {
          console.log(`    ${key}: ${JSON.stringify(value)}`);
        }
      }

      const documents = await memory.getDocuments();
      const items = await memory.getItems();
      const collections = await memory.getCollections();
      console.log(`\n  Documents: ${documents.length}`);
      console.log(`  Items tracked: ${items.length}`);
      if (collections.length > 0) {
        console.log(`  Collections: ${collections.join(', ')}`);
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
      const attrsStr = await ask('Anything else? (key=value pairs, comma separated, optional): ');

      rl.close();

      const attributes: Record<string, unknown> = {};
      if (attrsStr.trim()) {
        for (const pair of attrsStr.split(',')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            const key = pair.slice(0, eqIdx).trim();
            const value = pair.slice(eqIdx + 1).trim();
            attributes[key] = value;
          }
        }
      }

      await memory.saveProfile({
        name,
        email,
        phone: phone || undefined,
        location: location || undefined,
        attributes,
      });

      logger.success('Profile saved!');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

profileCmd
  .command('import')
  .description('Import a document (resume, requirements, etc.) from a text file')
  .argument('<file>', 'Path to text file')
  .option('--name <name>', 'Document name (defaults to filename)')
  .option('--type <type>', 'Document type', 'resume')
  .action(async (filePath: string, opts: Record<string, unknown>) => {
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

      const docType = (opts['type'] as string) || 'resume';
      const name = (opts['name'] as string) || path.basename(filePath, path.extname(filePath));
      const docId = crypto.randomUUID().slice(0, 8);
      await memory.saveDocument({
        id: docId,
        name,
        type: docType,
        content: text,
        updatedAt: Date.now(),
      });

      logger.success(`Document imported: "${name}" (${docType}, ${text.length} chars)`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// Items commands
const itemsCmd = program
  .command('items')
  .description('Manage tracked items');

itemsCmd
  .command('list')
  .description('List tracked items')
  .option('--collection <collection>', 'Filter by collection')
  .option('--status <status>', 'Filter by status (new, saved, applied, rejected, archived)')
  .option('--query <search>', 'Search across titles, notes, and fields')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const filter: Record<string, unknown> = {};
      if (opts['collection']) filter['collection'] = opts['collection'];
      if (opts['status']) filter['status'] = opts['status'];
      if (opts['query']) filter['query'] = opts['query'];
      const items = await memory.getItems(Object.keys(filter).length > 0 ? filter as never : undefined);

      if (items.length === 0) {
        logger.info('No tracked items. Use the tracker skill to save items while browsing.');
        return;
      }

      console.log(`\nTracked Items (${items.length}):`);
      for (const item of items) {
        const score = item.matchScore !== undefined ? ` [${item.matchScore}%]` : '';
        console.log(`  [${item.status}]${score} ${item.title}`);
        const meta: string[] = [];
        if (item.collection) meta.push(`Collection: ${item.collection}`);
        if (item.tags.length > 0) meta.push(`Tags: ${item.tags.join(', ')}`);
        if (meta.length > 0) console.log(`    ${meta.join(' · ')}`);
        console.log(`    URL: ${item.url}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

itemsCmd
  .command('collections')
  .description('List collections and item counts')
  .action(async () => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const collections = await memory.getCollections();

      if (collections.length === 0) {
        logger.info('No collections yet.');
        return;
      }

      console.log('\nCollections:');
      for (const collection of collections) {
        const items = await memory.getItems({ collection });
        console.log(`  ${collection}: ${items.length} items`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// Docs commands
const docsCmd = program
  .command('docs')
  .description('Manage documents');

docsCmd
  .command('list')
  .description('List stored documents')
  .option('--type <type>', 'Filter by document type')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const docType = opts['type'] as string | undefined;
      const documents = await memory.getDocuments(docType);

      if (documents.length === 0) {
        logger.info('No documents. Use `brmonk docs import <file>` to import one.');
        return;
      }

      console.log(`\nDocuments (${documents.length}):`);
      for (const doc of documents) {
        const date = new Date(doc.updatedAt).toLocaleString();
        console.log(`  [${doc.id}] ${doc.name} (${doc.type}, ${doc.content.length} chars)`);
        console.log(`    Updated: ${date}`);
      }
      console.log('');
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

docsCmd
  .command('show')
  .description('Show document content')
  .argument('<id>', 'Document ID')
  .action(async (id: string) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      const doc = await memory.getDocument(id);

      if (!doc) {
        logger.error(`Document '${id}' not found`);
        process.exitCode = 1;
        return;
      }

      console.log(`\nDocument: ${doc.name} (${doc.type})`);
      console.log(`Updated: ${new Date(doc.updatedAt).toLocaleString()}`);
      console.log('---');
      console.log(doc.content);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

docsCmd
  .command('import')
  .description('Import a document from a text file')
  .argument('<file>', 'Path to text file')
  .option('--name <name>', 'Document name (defaults to filename)')
  .option('--type <type>', 'Document type', 'resume')
  .action(async (filePath: string, opts: Record<string, unknown>) => {
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

      const docType = (opts['type'] as string) || 'resume';
      const name = (opts['name'] as string) || path.basename(filePath, path.extname(filePath));
      const docId = crypto.randomUUID().slice(0, 8);
      await memory.saveDocument({
        id: docId,
        name,
        type: docType,
        content: text,
        updatedAt: Date.now(),
      });

      logger.success(`Document imported: "${name}" (${docType}, ${text.length} chars)`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

docsCmd
  .command('delete')
  .description('Delete a stored document')
  .argument('<id>', 'Document ID')
  .action(async (id: string) => {
    try {
      const config = await loadConfig();
      const memory = new MemoryStore(config.memoryDir);
      await memory.deleteDocument(id);
      logger.success(`Document '${id}' deleted`);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program
  .command('web')
  .description('Start the web interface')
  .option('-p, --port <port>', 'Port number', '3333')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const { startWebServer } = await import('./web/server.js');
      const port = parseInt(String(opts['port']), 10);
      await startWebServer(port);
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
