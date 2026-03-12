/**
 * Runtime executor for rich skill action steps.
 * Executes shell commands, scripts, browser actions, LLM calls, and conditionals.
 */

import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BrowserEngine } from '../browser/engine.js';
import { ActionExecutor } from '../browser/actions.js';
import type { LLMProvider } from '../llm/types.js';
import type {
  RichSkill,
  ActionStep,
  ShellStep,
  ScriptStep,
  BrowserStep,
  LLMStep,
  ConditionalStep,
} from './types.js';
import { interpolate, type TemplateContext } from './template.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT = 30; // seconds

export class SkillExecutor {
  private browser: BrowserEngine;
  private llm: LLMProvider;
  private actionExecutor: ActionExecutor;

  constructor(browser: BrowserEngine, llm: LLMProvider, actionExecutor: ActionExecutor) {
    this.browser = browser;
    this.llm = llm;
    this.actionExecutor = actionExecutor;
  }

  /**
   * Execute a rich skill action (all steps in sequence).
   */
  async executeAction(
    skill: RichSkill,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const action = skill.manifest.actions[toolName];
    if (!action) {
      throw new Error(`No action defined for tool "${toolName}" in skill "${skill.manifest.name}"`);
    }

    let previousOutput = '';
    const results: string[] = [];

    for (const step of action.steps) {
      const ctx: TemplateContext = {
        args,
        previousStepOutput: previousOutput,
        env: process.env as Record<string, string | undefined>,
        skillDir: skill.skillDir,
        workingDir: process.cwd(),
      };

      try {
        const output = await this.executeStep(step, ctx, skill.skillDir);

        if (step.captureOutput !== false) {
          previousOutput = output;
          results.push(output);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Skill step error (${step.type}): ${errMsg}`);
        results.push(`Error in ${step.type} step: ${errMsg}`);
        break; // Stop on error
      }
    }

    return results.join('\n---\n');
  }

  private async executeStep(step: ActionStep, ctx: TemplateContext, skillDir: string): Promise<string> {
    switch (step.type) {
      case 'shell':
        return this.executeShell(step, ctx);
      case 'script':
        return this.executeScript(step, ctx, skillDir);
      case 'browser':
        return this.executeBrowser(step, ctx);
      case 'llm':
        return this.executeLLM(step, ctx);
      case 'conditional':
        return this.executeConditional(step, ctx, skillDir);
    }
  }

  private async executeShell(step: ShellStep, ctx: TemplateContext): Promise<string> {
    const command = interpolate(step.command, ctx);
    const cwd = step.cwd ? interpolate(step.cwd, ctx) : ctx.workingDir;
    const timeout = (step.timeout ?? DEFAULT_TIMEOUT) * 1000;

    const env = { ...process.env };
    if (step.env) {
      for (const [key, value] of Object.entries(step.env)) {
        env[key] = interpolate(value, ctx);
      }
    }

    logger.tool('shell', { command: command.slice(0, 100) });

    return new Promise<string>((resolve, reject) => {
      const proc = execFile('bash', ['-c', command], {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        env,
      }, (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          reject(new Error(`Shell command timed out after ${step.timeout ?? DEFAULT_TIMEOUT}s`));
          return;
        }
        const output = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '');
        // Return output even on non-zero exit — the LLM may want to see the error
        resolve(output.trim() || (error ? `Exit code: ${error.code ?? 'unknown'}` : 'Command completed (no output)'));
      });

      // Safety: force kill if process handle exists
      if (proc.pid) {
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }, timeout + 5000);
      }
    });
  }

  private async executeScript(step: ScriptStep, ctx: TemplateContext, skillDir: string): Promise<string> {
    const scriptPath = path.resolve(skillDir, step.file);
    const timeout = (step.timeout ?? DEFAULT_TIMEOUT) * 1000;

    // Auto-detect runtime from file extension
    let runtime = step.runtime;
    if (!runtime) {
      const ext = path.extname(scriptPath);
      if (ext === '.py') runtime = 'python';
      else if (ext === '.mjs' || ext === '.js' || ext === '.ts') runtime = 'node';
      else if (ext === '.sh' || ext === '.bash') runtime = 'bash';
      else runtime = 'bash'; // default
    }

    // Build command based on runtime
    let executable: string;
    switch (runtime) {
      case 'python':
        executable = 'python3';
        break;
      case 'node':
        executable = 'node';
        break;
      case 'bash':
        executable = 'bash';
        break;
      default:
        executable = runtime;
    }

    const args = (step.args ?? []).map(a => interpolate(String(a), ctx));

    const env = { ...process.env };
    if (step.env) {
      for (const [key, value] of Object.entries(step.env)) {
        env[key] = interpolate(value, ctx);
      }
    }

    logger.tool('script', { file: step.file, runtime, args: args.slice(0, 3) });

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(executable, [scriptPath, ...args], {
        cwd: skillDir,
        timeout,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to execute script "${step.file}": ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === null) {
          reject(new Error(`Script "${step.file}" timed out after ${step.timeout ?? DEFAULT_TIMEOUT}s`));
          return;
        }
        const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');
        resolve(output.trim() || `Script completed with exit code ${code}`);
      });

      // Safety kill
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, timeout + 5000);
    });
  }

  private async executeBrowser(step: BrowserStep, ctx: TemplateContext): Promise<string> {
    const results: string[] = [];

    for (const actionDef of step.actions) {
      // Each action is { actionName: { ...args } }
      const entries = Object.entries(actionDef);
      if (entries.length === 0) continue;

      const [actionName, rawArgs] = entries[0] as [string, unknown];
      const args: Record<string, unknown> = {};

      // Interpolate string values in args
      if (rawArgs && typeof rawArgs === 'object') {
        for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
          if (typeof value === 'string') {
            args[key] = interpolate(value, ctx);
          } else {
            args[key] = value;
          }
        }
      }

      logger.tool('browser', { action: actionName });

      const result = await this.actionExecutor.execute(actionName, args);
      results.push(`${actionName}: ${result.message}`);
    }

    return results.join('\n');
  }

  private async executeLLM(step: LLMStep, ctx: TemplateContext): Promise<string> {
    const prompt = interpolate(step.prompt, ctx);

    logger.tool('llm', { promptLength: prompt.length });

    const response = await this.llm.chat(
      [{ role: 'user', content: prompt }],
      {
        temperature: step.temperature ?? 0.2,
        maxTokens: step.maxTokens ?? 1024,
      },
    );

    return response.content ?? '';
  }

  private async executeConditional(step: ConditionalStep, ctx: TemplateContext, skillDir: string): Promise<string> {
    const condition = interpolate(step.condition, ctx);

    // Simple condition evaluation:
    // - "contains" operator: "{{var}}" contains "text"
    // - Truthy check: non-empty, non-"false", non-"0"
    let conditionMet: boolean;

    const containsMatch = condition.match(/^"?(.*?)"?\s+contains\s+"(.*?)"$/i);
    const equalsMatch = condition.match(/^"?(.*?)"?\s*===?\s*"(.*?)"$/);

    if (containsMatch) {
      conditionMet = (containsMatch[1] ?? '').includes(containsMatch[2] ?? '');
    } else if (equalsMatch) {
      conditionMet = (equalsMatch[1] ?? '') === (equalsMatch[2] ?? '');
    } else {
      // Truthy check
      conditionMet = condition !== '' && condition !== 'false' && condition !== '0' && condition !== 'undefined' && condition !== 'null';
    }

    const steps = conditionMet ? step.then : (step.else ?? []);
    const results: string[] = [];

    for (const subStep of steps) {
      const output = await this.executeStep(subStep, ctx, skillDir);
      results.push(output);
    }

    return results.join('\n');
  }
}
