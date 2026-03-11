import * as path from 'node:path';
import * as os from 'node:os';
import type { Skill, SkillContext } from '../types.js';

export const screenshotSkill: Skill = {
  name: 'screenshot',
  description: 'Take screenshots of the current page',
  version: '1.0.0',
  systemPrompt: `You can take screenshots of the current page:
- takeScreenshot(options?): Take a screenshot of the visible viewport
- takeFullPageScreenshot(): Take a full-page screenshot including scrolled content`,
  tools: [
    {
      name: 'takeScreenshot',
      description: 'Take a screenshot of the current page viewport',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to save the screenshot (optional)' },
        },
      },
    },
    {
      name: 'takeFullPageScreenshot',
      description: 'Take a full-page screenshot including all scrolled content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to save the screenshot (optional)' },
        },
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    const page = context.browser.currentPage();
    const defaultPath = path.join(os.tmpdir(), `brmonk-screenshot-${Date.now()}.png`);
    const filePath = (args['path'] as string) ?? defaultPath;

    switch (toolName) {
      case 'takeScreenshot': {
        await page.screenshot({ path: filePath, fullPage: false });
        return `Screenshot saved to ${filePath}`;
      }

      case 'takeFullPageScreenshot': {
        await page.screenshot({ path: filePath, fullPage: true });
        return `Full page screenshot saved to ${filePath}`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};
