import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Skill } from './types.js';
import type { LLMToolDefinition } from '../llm/types.js';
import { webSearchSkill } from './builtin/web-search.js';
import { dataExtractSkill } from './builtin/data-extract.js';
import { formFillSkill } from './builtin/form-fill.js';
import { screenshotSkill } from './builtin/screenshot.js';
import { navigateSkill } from './builtin/navigate.js';
import { jobSearchSkill } from './builtin/job-search.js';
import { resumeAnalyzerSkill } from './builtin/resume-analyzer.js';
import { smartBrowseSkill } from './builtin/smart-browse.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    // Register built-in skills
    this.register(webSearchSkill);
    this.register(dataExtractSkill);
    this.register(formFillSkill);
    this.register(screenshotSkill);
    this.register(navigateSkill);
    this.register(jobSearchSkill);
    this.register(resumeAnalyzerSkill);
    this.register(smartBrowseSkill);
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  async loadFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.js') && !entry.endsWith('.ts')) continue;
        try {
          const fullPath = path.resolve(dir, entry);
          const mod = await import(fullPath) as { default?: Skill; skill?: Skill };
          const skill = mod.default ?? mod.skill;
          if (skill && skill.name && skill.tools) {
            this.register(skill);
          }
        } catch {
          // Skip files that can't be loaded
        }
      }
    } catch {
      // Directory doesn't exist, which is fine
    }
  }

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
}
