import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Skill, RichSkill } from './types.js';
import type { LLMToolDefinition } from '../llm/types.js';
import { webSearchSkill } from './builtin/web-search.js';
import { dataExtractSkill } from './builtin/data-extract.js';
import { formFillSkill } from './builtin/form-fill.js';
import { screenshotSkill } from './builtin/screenshot.js';
import { navigateSkill } from './builtin/navigate.js';
import { trackerSkill } from './builtin/tracker.js';
import { documentsSkill } from './builtin/documents.js';
import { smartBrowseSkill } from './builtin/smart-browse.js';
import { loadRichSkill } from './loader.js';
import { logger } from '../utils/logger.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private richSkills: Map<string, RichSkill> = new Map();

  constructor() {
    // Register built-in skills
    this.register(webSearchSkill);
    this.register(dataExtractSkill);
    this.register(formFillSkill);
    this.register(screenshotSkill);
    this.register(navigateSkill);
    this.register(trackerSkill);
    this.register(documentsSkill);
    this.register(smartBrowseSkill);
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  registerRich(skill: RichSkill): void {
    this.richSkills.set(skill.manifest.name, skill);
  }

  async loadFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name);

        if (entry.isDirectory()) {
          // Check for skill.yaml or skill.yml inside the directory
          const yamlPath = path.join(fullPath, 'skill.yaml');
          const ymlPath = path.join(fullPath, 'skill.yml');
          let hasYaml = false;
          try {
            await fs.access(yamlPath);
            hasYaml = true;
          } catch {
            try {
              await fs.access(ymlPath);
              hasYaml = true;
            } catch {
              // Not a rich skill directory
            }
          }

          if (hasYaml) {
            try {
              const richSkill = await loadRichSkill(fullPath);
              this.registerRich(richSkill);
              logger.info(`Loaded rich skill: ${richSkill.manifest.name} v${richSkill.manifest.version}`);
            } catch (err) {
              logger.error(`Failed to load rich skill from ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
            }
            continue;
          }

          // Legacy: try loading .js/.ts files from subdirectories
        }

        // Load .yaml/.yml files directly
        if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
          try {
            const richSkill = await loadRichSkill(fullPath);
            this.registerRich(richSkill);
            logger.info(`Loaded rich skill: ${richSkill.manifest.name} v${richSkill.manifest.version}`);
          } catch (err) {
            logger.error(`Failed to load rich skill from ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
          }
          continue;
        }

        // Legacy: load .js/.ts files as TypeScript skill modules
        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
          try {
            const mod = await import(fullPath) as { default?: Skill; skill?: Skill };
            const skill = mod.default ?? mod.skill;
            if (skill && skill.name && skill.tools) {
              this.register(skill);
            }
          } catch {
            // Skip files that can't be loaded
          }
        }
      }
    } catch {
      // Directory doesn't exist, which is fine
    }
  }

  // --- Built-in skill methods (backward compatible) ---

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getToolsForSkills(skillNames: string[]): LLMToolDefinition[] {
    const tools: LLMToolDefinition[] = [];
    for (const name of skillNames) {
      const skill = this.skills.get(name);
      if (skill) {
        tools.push(...skill.tools);
      }
    }
    return tools;
  }

  getSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  // --- Rich skill methods (new) ---

  getRichSkill(name: string): RichSkill | undefined {
    return this.richSkills.get(name);
  }

  listRichSkills(): RichSkill[] {
    return Array.from(this.richSkills.values());
  }

  findRichSkillForTool(toolName: string): RichSkill | undefined {
    for (const skill of this.richSkills.values()) {
      if (skill.manifest.tools.some(t => t.name === toolName)) {
        return skill;
      }
    }
    return undefined;
  }

  // --- Combined methods ---

  getAllToolDefinitions(): LLMToolDefinition[] {
    const tools: LLMToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      tools.push(...skill.tools);
    }
    for (const skill of this.richSkills.values()) {
      tools.push(...skill.manifest.tools);
    }
    return tools;
  }

  getSystemPromptExtensions(): string {
    let prompt = '';
    for (const skill of this.skills.values()) {
      if (skill.systemPrompt) {
        prompt += `\n\n## Skill: ${skill.name}\n${skill.systemPrompt}`;
      }
    }
    for (const skill of this.richSkills.values()) {
      prompt += `\n\n## Skill: ${skill.manifest.name}\n${skill.manifest.instructions}`;
    }
    return prompt;
  }

  getAllSkillNames(): string[] {
    return [
      ...this.skills.keys(),
      ...Array.from(this.richSkills.values()).map(s => s.manifest.name),
    ];
  }

  getSkillCount(): { builtin: number; rich: number; total: number } {
    return {
      builtin: this.skills.size,
      rich: this.richSkills.size,
      total: this.skills.size + this.richSkills.size,
    };
  }
}
