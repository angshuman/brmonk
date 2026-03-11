import type { Skill, SkillContext } from '../types.js';
import { extractDOM } from '../../browser/dom.js';

interface NavigationStep {
  action: string;
  target?: string;
  value?: string;
}

export const navigateSkill: Skill = {
  name: 'navigate',
  description: 'Multi-step navigation flows',
  version: '1.0.0',
  systemPrompt: `You can perform multi-step navigation flows:
- navigateFlow(steps): Execute a sequence of navigation actions. Each step has an "action" (click, type, goto, wait), optional "target" (element text or URL), and optional "value" (text to type).`,
  tools: [
    {
      name: 'navigateFlow',
      description: 'Execute a sequence of navigation actions. Steps: [{action: "goto"|"click"|"type"|"wait", target?: string, value?: string}]',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', description: 'Action: goto, click, type, or wait' },
                target: { type: 'string', description: 'URL for goto, element text for click/type' },
                value: { type: 'string', description: 'Text to type (for type action)' },
              },
              required: ['action'],
            },
            description: 'Array of navigation steps to execute',
          },
        },
        required: ['steps'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    if (toolName !== 'navigateFlow') return `Unknown tool: ${toolName}`;

    const steps = args['steps'] as NavigationStep[];
    if (!Array.isArray(steps)) return 'Error: steps must be an array';

    const page = context.browser.currentPage();
    const results: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      try {
        switch (step.action) {
          case 'goto': {
            if (!step.target) {
              results.push(`Step ${i + 1}: Error - goto requires a target URL`);
              break;
            }
            await page.goto(step.target, { waitUntil: 'domcontentloaded', timeout: 15000 });
            results.push(`Step ${i + 1}: Navigated to ${step.target}`);
            break;
          }

          case 'click': {
            if (!step.target) {
              results.push(`Step ${i + 1}: Error - click requires a target`);
              break;
            }
            const dom = await extractDOM(page);
            const lowerTarget = step.target.toLowerCase();
            const element = dom.elements.find(el =>
              el.text.toLowerCase().includes(lowerTarget) ||
              el.ariaLabel?.toLowerCase().includes(lowerTarget) ||
              el.href?.toLowerCase().includes(lowerTarget)
            );

            if (element) {
              await page.evaluate(
                ({ sel, idx }) => {
                  const nodes = document.querySelectorAll(sel);
                  let visibleIndex = 0;
                  for (const node of nodes) {
                    const el = node as HTMLElement;
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    const visible = rect.width > 0 && rect.height > 0 &&
                      style.display !== 'none' && style.visibility !== 'hidden' &&
                      style.opacity !== '0';
                    if (!visible) continue;
                    visibleIndex++;
                    if (visibleIndex === idx) {
                      el.click();
                      return;
                    }
                  }
                },
                {
                  sel: 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]',
                  idx: element.index,
                }
              );
              await page.waitForTimeout(500);
              results.push(`Step ${i + 1}: Clicked "${step.target}" [${element.index}]`);
            } else {
              results.push(`Step ${i + 1}: Could not find element matching "${step.target}"`);
            }
            break;
          }

          case 'type': {
            if (!step.target || !step.value) {
              results.push(`Step ${i + 1}: Error - type requires target and value`);
              break;
            }
            const typeDom = await extractDOM(page);
            const lowerTypTarget = step.target.toLowerCase();
            const inputEl = typeDom.elements.find(el =>
              (el.tag === 'input' || el.tag === 'textarea') && (
                el.name?.toLowerCase().includes(lowerTypTarget) ||
                el.placeholder?.toLowerCase().includes(lowerTypTarget) ||
                el.ariaLabel?.toLowerCase().includes(lowerTypTarget)
              )
            );

            if (inputEl) {
              await page.evaluate(
                ({ sel, idx }) => {
                  const nodes = document.querySelectorAll(sel);
                  let visibleIndex = 0;
                  for (const node of nodes) {
                    const el = node as HTMLElement;
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    const visible = rect.width > 0 && rect.height > 0 &&
                      style.display !== 'none' && style.visibility !== 'hidden' &&
                      style.opacity !== '0';
                    if (!visible) continue;
                    visibleIndex++;
                    if (visibleIndex === idx) {
                      (el as HTMLInputElement).value = '';
                      el.focus();
                      return;
                    }
                  }
                },
                {
                  sel: 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]',
                  idx: inputEl.index,
                }
              );
              await page.keyboard.type(step.value, { delay: 20 });
              results.push(`Step ${i + 1}: Typed "${step.value}" into "${step.target}"`);
            } else {
              results.push(`Step ${i + 1}: Could not find input matching "${step.target}"`);
            }
            break;
          }

          case 'wait': {
            const timeout = step.value ? parseInt(step.value, 10) : 2000;
            await page.waitForTimeout(timeout);
            results.push(`Step ${i + 1}: Waited ${timeout}ms`);
            break;
          }

          default:
            results.push(`Step ${i + 1}: Unknown action "${step.action}"`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`Step ${i + 1}: Error - ${msg}`);
      }
    }

    return results.join('\n');
  },
};
