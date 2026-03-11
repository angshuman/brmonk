import type { Skill, SkillContext } from '../types.js';
import { extractDOM } from '../../browser/dom.js';

export const formFillSkill: Skill = {
  name: 'form-fill',
  description: 'Intelligently fill out web forms',
  version: '1.0.0',
  systemPrompt: `You can fill forms using:
- fillForm(data): Pass key-value pairs to fill form fields. Keys should match field names, labels, or placeholders.
- submitForm(): Submit the current form.`,
  tools: [
    {
      name: 'fillForm',
      description: 'Fill form fields with the provided key-value pairs. Keys should match field names, labels, or placeholders.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Key-value pairs where keys match form field names/labels and values are the data to fill',
          },
        },
        required: ['data'],
      },
    },
    {
      name: 'submitForm',
      description: 'Submit the current form by clicking the submit button',
      parameters: { type: 'object', properties: {} },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    const page = context.browser.currentPage();

    switch (toolName) {
      case 'fillForm': {
        const data = args['data'] as Record<string, string>;
        if (!data || typeof data !== 'object') return 'Error: data must be an object with key-value pairs';

        const dom = await extractDOM(page);
        const filled: string[] = [];
        const notFound: string[] = [];

        for (const [key, value] of Object.entries(data)) {
          const lowerKey = key.toLowerCase();
          // Find matching element by name, placeholder, aria-label, or text
          const match = dom.elements.find(el =>
            (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') && (
              el.name?.toLowerCase().includes(lowerKey) ||
              el.placeholder?.toLowerCase().includes(lowerKey) ||
              el.ariaLabel?.toLowerCase().includes(lowerKey) ||
              el.text.toLowerCase().includes(lowerKey)
            )
          );

          if (match) {
            if (match.tag === 'select') {
              await page.evaluate(
                ({ sel, idx, val }) => {
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
                      (el as HTMLSelectElement).value = val;
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      return;
                    }
                  }
                },
                {
                  sel: 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]',
                  idx: match.index,
                  val: value,
                }
              );
            } else {
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
                  idx: match.index,
                }
              );
              await page.keyboard.type(value, { delay: 20 });
            }
            filled.push(`${key}: "${value}" -> [${match.index}] ${match.tag}`);
          } else {
            notFound.push(key);
          }
        }

        let result = '';
        if (filled.length > 0) result += `Filled fields:\n${filled.join('\n')}`;
        if (notFound.length > 0) result += `\nCould not find fields: ${notFound.join(', ')}`;
        return result || 'No fields were filled';
      }

      case 'submitForm': {
        const dom = await extractDOM(page);
        // Find submit button
        const submitBtn = dom.elements.find(el =>
          (el.tag === 'button' || el.tag === 'input') && (
            el.type === 'submit' ||
            el.text.toLowerCase().includes('submit') ||
            el.text.toLowerCase().includes('send') ||
            el.text.toLowerCase().includes('save') ||
            el.ariaLabel?.toLowerCase().includes('submit')
          )
        );

        if (submitBtn) {
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
              idx: submitBtn.index,
            }
          );
          await page.waitForTimeout(1000);
          return `Form submitted by clicking [${submitBtn.index}] "${submitBtn.text}"`;
        }

        // Fallback: press Enter
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        return 'No submit button found. Pressed Enter to submit.';
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};
