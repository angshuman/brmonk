/**
 * YAML skill loader — parses and validates rich skill files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYAML } from 'yaml';
import type { RichSkill, RichSkillManifest, ActionStep } from './types.js';

/**
 * Load a rich skill from a path.
 * Path can be:
 *   - A directory containing skill.yaml
 *   - A single .yaml file
 */
export async function loadRichSkill(skillPath: string): Promise<RichSkill> {
  const stat = await fs.stat(skillPath);
  let yamlPath: string;
  let skillDir: string;

  if (stat.isDirectory()) {
    yamlPath = path.join(skillPath, 'skill.yaml');
    skillDir = skillPath;
    // Also check skill.yml
    try {
      await fs.access(yamlPath);
    } catch {
      yamlPath = path.join(skillPath, 'skill.yml');
      await fs.access(yamlPath).catch(() => {
        throw new Error(`No skill.yaml or skill.yml found in ${skillPath}`);
      });
    }
  } else {
    yamlPath = skillPath;
    skillDir = path.dirname(skillPath);
  }

  const content = await fs.readFile(yamlPath, 'utf-8');
  let raw: unknown;
  try {
    raw = parseYAML(content);
  } catch (err) {
    throw new Error(`Failed to parse YAML at ${yamlPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const manifest = validateManifest(raw, yamlPath);

  // Resolve script file paths relative to skill directory
  for (const [, action] of Object.entries(manifest.actions)) {
    for (const step of action.steps) {
      if (step.type === 'script' && step.file) {
        // Validate the script file exists
        const scriptPath = path.resolve(skillDir, step.file);
        try {
          await fs.access(scriptPath);
        } catch {
          throw new Error(`Script file not found: ${step.file} (resolved to ${scriptPath}) in skill "${manifest.name}"`);
        }
      }
    }
  }

  // Validate environment requirements
  if (manifest.env?.required) {
    const missing = manifest.env.required.filter(v => !process.env[v]);
    if (missing.length > 0) {
      // Warn but don't fail — the env var might be set later
      console.warn(`[skill:${manifest.name}] Warning: missing required env vars: ${missing.join(', ')}`);
    }
  }

  return {
    kind: 'rich',
    manifest,
    skillDir: path.resolve(skillDir),
  };
}

/**
 * Validate a raw parsed YAML object as a RichSkillManifest.
 */
export function validateManifest(raw: unknown, filePath: string): RichSkillManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid skill manifest at ${filePath}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['name', 'version', 'description', 'instructions'] as const;
  for (const field of requiredStrings) {
    if (!obj[field] || typeof obj[field] !== 'string') {
      throw new Error(`Skill at ${filePath}: missing or invalid "${field}" (must be a non-empty string)`);
    }
  }

  // Validate name format (kebab-case)
  const name = obj['name'] as string;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    throw new Error(`Skill at ${filePath}: name "${name}" must be kebab-case (lowercase letters, numbers, hyphens)`);
  }

  // Tools array
  if (!Array.isArray(obj['tools'])) {
    throw new Error(`Skill at ${filePath}: "tools" must be an array`);
  }
  const tools = obj['tools'] as Array<Record<string, unknown>>;
  for (const tool of tools) {
    if (!tool['name'] || typeof tool['name'] !== 'string') {
      throw new Error(`Skill at ${filePath}: each tool must have a "name" string`);
    }
    if (!tool['description'] || typeof tool['description'] !== 'string') {
      throw new Error(`Skill at ${filePath}: tool "${tool['name']}" must have a "description" string`);
    }
    if (!tool['parameters'] || typeof tool['parameters'] !== 'object') {
      throw new Error(`Skill at ${filePath}: tool "${tool['name']}" must have a "parameters" object`);
    }
  }

  // Actions object
  if (!obj['actions'] || typeof obj['actions'] !== 'object' || Array.isArray(obj['actions'])) {
    throw new Error(`Skill at ${filePath}: "actions" must be an object mapping tool names to action definitions`);
  }
  const actions = obj['actions'] as Record<string, unknown>;

  // Every tool must have a matching action
  for (const tool of tools) {
    const toolName = tool['name'] as string;
    if (!actions[toolName]) {
      throw new Error(`Skill at ${filePath}: tool "${toolName}" has no matching action definition`);
    }
  }

  // Validate action step types
  for (const [actionName, actionDef] of Object.entries(actions)) {
    if (!actionDef || typeof actionDef !== 'object') {
      throw new Error(`Skill at ${filePath}: action "${actionName}" must be an object`);
    }
    const actionObj = actionDef as Record<string, unknown>;
    if (!Array.isArray(actionObj['steps'])) {
      throw new Error(`Skill at ${filePath}: action "${actionName}" must have a "steps" array`);
    }
    for (const step of actionObj['steps'] as unknown[]) {
      validateStep(step, actionName, filePath);
    }
  }

  // Build the validated manifest
  const manifest: RichSkillManifest = {
    name,
    version: obj['version'] as string,
    description: obj['description'] as string,
    instructions: obj['instructions'] as string,
    author: typeof obj['author'] === 'string' ? obj['author'] : undefined,
    tags: Array.isArray(obj['tags']) ? (obj['tags'] as string[]) : undefined,
    tools: tools.map(t => ({
      name: t['name'] as string,
      description: t['description'] as string,
      parameters: t['parameters'] as Record<string, unknown>,
    })),
    actions: {} as Record<string, { steps: ActionStep[] }>,
  };

  // Parse env
  if (obj['env'] && typeof obj['env'] === 'object') {
    const envObj = obj['env'] as Record<string, unknown>;
    manifest.env = {
      required: Array.isArray(envObj['required']) ? envObj['required'] as string[] : undefined,
      optional: Array.isArray(envObj['optional']) ? envObj['optional'] as string[] : undefined,
    };
  }

  // Parse actions with validated steps
  for (const [actionName, actionDef] of Object.entries(actions)) {
    const actionObj = actionDef as Record<string, unknown>;
    const steps = (actionObj['steps'] as unknown[]).map(s => parseStep(s as Record<string, unknown>));
    manifest.actions[actionName] = { steps };
  }

  return manifest;
}

function validateStep(step: unknown, actionName: string, filePath: string): void {
  if (!step || typeof step !== 'object') {
    throw new Error(`Skill at ${filePath}: action "${actionName}" has an invalid step (must be an object)`);
  }
  const s = step as Record<string, unknown>;
  const validTypes = ['shell', 'script', 'browser', 'llm', 'conditional'];
  if (!s['type'] || !validTypes.includes(s['type'] as string)) {
    throw new Error(
      `Skill at ${filePath}: action "${actionName}" has a step with invalid type "${s['type']}". Must be one of: ${validTypes.join(', ')}`,
    );
  }

  // Type-specific validation
  if (s['type'] === 'shell' && typeof s['command'] !== 'string') {
    throw new Error(`Skill at ${filePath}: action "${actionName}" shell step must have a "command" string`);
  }
  if (s['type'] === 'script' && typeof s['file'] !== 'string') {
    throw new Error(`Skill at ${filePath}: action "${actionName}" script step must have a "file" string`);
  }
  if (s['type'] === 'browser' && !Array.isArray(s['actions'])) {
    throw new Error(`Skill at ${filePath}: action "${actionName}" browser step must have an "actions" array`);
  }
  if (s['type'] === 'llm' && typeof s['prompt'] !== 'string') {
    throw new Error(`Skill at ${filePath}: action "${actionName}" llm step must have a "prompt" string`);
  }
  if (s['type'] === 'conditional') {
    if (typeof s['condition'] !== 'string') {
      throw new Error(`Skill at ${filePath}: action "${actionName}" conditional step must have a "condition" string`);
    }
    if (!Array.isArray(s['then'])) {
      throw new Error(`Skill at ${filePath}: action "${actionName}" conditional step must have a "then" array`);
    }
    for (const sub of s['then'] as unknown[]) {
      validateStep(sub, actionName, filePath);
    }
    if (s['else'] && Array.isArray(s['else'])) {
      for (const sub of s['else'] as unknown[]) {
        validateStep(sub, actionName, filePath);
      }
    }
  }
}

function parseStep(s: Record<string, unknown>): ActionStep {
  const base = {
    captureOutput: s['captureOutput'] !== false,
    timeout: typeof s['timeout'] === 'number' ? s['timeout'] : undefined,
  };

  switch (s['type']) {
    case 'shell':
      return {
        type: 'shell',
        command: s['command'] as string,
        cwd: s['cwd'] as string | undefined,
        env: s['env'] as Record<string, string> | undefined,
        ...base,
      };
    case 'script':
      return {
        type: 'script',
        file: s['file'] as string,
        runtime: s['runtime'] as 'python' | 'node' | 'bash' | undefined,
        args: Array.isArray(s['args']) ? s['args'] as string[] : undefined,
        env: s['env'] as Record<string, string> | undefined,
        ...base,
      };
    case 'browser':
      return {
        type: 'browser',
        actions: s['actions'] as Array<Record<string, unknown>>,
        ...base,
      };
    case 'llm':
      return {
        type: 'llm',
        prompt: s['prompt'] as string,
        temperature: typeof s['temperature'] === 'number' ? s['temperature'] : undefined,
        maxTokens: typeof s['maxTokens'] === 'number' ? s['maxTokens'] : undefined,
        ...base,
      };
    case 'conditional':
      return {
        type: 'conditional',
        condition: s['condition'] as string,
        then: (s['then'] as Array<Record<string, unknown>>).map(parseStep),
        else: s['else'] ? (s['else'] as Array<Record<string, unknown>>).map(parseStep) : undefined,
        ...base,
      };
    default:
      throw new Error(`Unknown step type: ${s['type']}`);
  }
}
