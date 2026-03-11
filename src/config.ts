import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { config as loadDotenv } from 'dotenv';

export interface Config {
  provider: 'claude' | 'openai' | 'grok' | 'auto';
  model: string;
  headless: boolean;
  maxSteps: number;
  memoryDir: string;
  skillsDir: string;
  timeout: number;
  verbose: boolean;
  autoDismissPopups: boolean;
  autoHandleDialogs: boolean;
  pauseOnCaptcha: boolean;
  pauseOnLogin: boolean;
  persistBrowserContext: boolean;
}

const DEFAULTS: Config = {
  provider: 'auto',
  model: '',
  headless: false,
  maxSteps: 50,
  memoryDir: path.join(os.homedir(), '.brmonk'),
  skillsDir: path.join(os.homedir(), '.brmonk', 'skills'),
  timeout: 120000,
  verbose: false,
  autoDismissPopups: true,
  autoHandleDialogs: true,
  pauseOnCaptcha: true,
  pauseOnLogin: true,
  persistBrowserContext: true,
};

export async function loadConfig(cliOverrides?: Partial<Config>): Promise<Config> {
  // Load .env file
  loadDotenv();

  // Load config file
  let fileConfig: Partial<Config> = {};
  const configPath = path.join(os.homedir(), '.brmonk', 'config.json');
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    fileConfig = JSON.parse(data) as Partial<Config>;
  } catch {
    // No config file
  }

  // Load from env vars
  const envConfig: Partial<Config> = {};
  if (process.env['BRMONK_MODEL']) envConfig.model = process.env['BRMONK_MODEL'];
  if (process.env['BRMONK_HEADLESS'] !== undefined) envConfig.headless = process.env['BRMONK_HEADLESS'] !== 'false';
  if (process.env['BRMONK_MEMORY_DIR']) envConfig.memoryDir = expandHome(process.env['BRMONK_MEMORY_DIR']);
  if (process.env['BRMONK_SKILLS_DIR']) envConfig.skillsDir = expandHome(process.env['BRMONK_SKILLS_DIR']);

  // Merge: defaults < file < env < CLI
  return {
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
    ...(cliOverrides ?? {}),
  };
}

export async function saveConfig(key: string, value: string): Promise<void> {
  const configDir = path.join(os.homedir(), '.brmonk');
  const configPath = path.join(configDir, 'config.json');

  await fs.mkdir(configDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    existing = JSON.parse(data) as Record<string, unknown>;
  } catch {
    // No existing config
  }

  // Parse value
  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

  existing[key] = parsed;
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export async function showConfig(): Promise<Config> {
  return loadConfig();
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
