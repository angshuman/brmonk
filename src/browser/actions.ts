import type { Page } from 'playwright';
import type { DOMElement } from './dom.js';
import type { BrowserEngine } from './engine.js';
import type { LLMToolDefinition } from '../llm/types.js';
import { extractDOM } from './dom.js';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export class ActionExecutor {
  private engine: BrowserEngine;
  private elementMap: Map<number, DOMElement> = new Map();
  private taskDone = false;
  private taskFailed = false;
  private taskResult: string | null = null;

  constructor(engine: BrowserEngine) {
    this.engine = engine;
  }

  updateElementMap(elementMap: Map<number, DOMElement>): void {
    this.elementMap = elementMap;
  }

  isDone(): boolean {
    return this.taskDone;
  }

  isFailed(): boolean {
    return this.taskFailed;
  }

  getResult(): string | null {
    return this.taskResult;
  }

  resetStatus(): void {
    this.taskDone = false;
    this.taskFailed = false;
    this.taskResult = null;
  }

  private async getElementHandle(index: number): Promise<{ page: Page; selector: string }> {
    const page = this.engine.currentPage();
    const element = this.elementMap.get(index);
    if (!element) {
      throw new Error(`Element [${index}] not found in current DOM snapshot`);
    }

    // Build a selector to find the element by its properties
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [role="listbox"], [role="option"], [role="searchbox"], [onclick], [tabindex], summary, details, [contenteditable], [draggable="true"], label[for]';

    // Use evaluate to find the specific element by index
    const exists = await page.evaluate(
      ({ selectors: sel, targetIndex }) => {
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
          if (visibleIndex === targetIndex) return true;
        }
        return false;
      },
      { selectors, targetIndex: index }
    );

    if (!exists) {
      throw new Error(`Element [${index}] is no longer visible on the page`);
    }

    return { page, selector: selectors };
  }

  private async performOnElement(index: number, action: (page: Page, targetIndex: number, selectors: string) => Promise<void>): Promise<void> {
    const { page, selector } = await this.getElementHandle(index);
    await action(page, index, selector);
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ActionResult> {
    try {
      switch (toolName) {
        case 'click':
          return await this.click(args['index'] as number);
        case 'type':
          return await this.typeText(args['index'] as number, args['text'] as string);
        case 'selectOption':
          return await this.selectOption(args['index'] as number, args['value'] as string);
        case 'hover':
          return await this.hover(args['index'] as number);
        case 'scroll':
          return await this.scroll(args['direction'] as 'up' | 'down', args['amount'] as number | undefined);
        case 'goTo':
          return await this.goTo(args['url'] as string);
        case 'goBack':
          return await this.goBack();
        case 'waitForLoad':
          return await this.waitForLoad(args['timeout'] as number | undefined);
        case 'screenshot':
          return await this.screenshot(args['path'] as string | undefined);
        case 'getPageContent':
          return await this.getPageContent();
        case 'evaluate':
          return await this.evaluateScript(args['script'] as string);
        case 'newTab':
          return await this.newTab(args['url'] as string | undefined);
        case 'switchTab':
          return await this.switchTabAction(args['index'] as number);
        case 'done':
          return await this.done(args['result'] as string);
        case 'fail':
          return await this.fail(args['reason'] as string);
        case 'dismissPopups':
          return await this.dismissPopupsAction();
        case 'waitForUser':
          return await this.waitForUserAction(args['message'] as string);
        case 'extractText':
          return await this.extractTextAction(args['selector'] as string | undefined);
        case 'fillFormField':
          return await this.fillFormFieldAction(args['label'] as string, args['value'] as string);
        case 'clickByText':
          return await this.clickByTextAction(args['text'] as string);
        case 'scrollToElement':
          return await this.scrollToElementAction(args['index'] as number);
        case 'waitForElement':
          return await this.waitForElementAction(args['text'] as string, args['timeout'] as number | undefined);
        default:
          return { success: false, message: `Unknown action: ${toolName}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let suggestion = '';
      if (message.includes('not found') || message.includes('no longer visible')) {
        suggestion = ' Try getPageContent() to see the current state — the page may have changed.';
      } else if (message.includes('timeout') || message.includes('Timeout')) {
        suggestion = ' The page may still be loading. Try waitForLoad() or navigate to a different URL.';
      } else if (toolName === 'evaluate') {
        suggestion = ' Check syntax and try a simpler script.';
      }
      return { success: false, message: `Action '${toolName}' failed: ${message}${suggestion}` };
    }
  }

  private async click(index: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await this.performOnElement(index, async (p, targetIndex, selectors) => {
      await p.evaluate(
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
        { sel: selectors, idx: targetIndex }
      );
    });
    await page.waitForTimeout(500);
    return { success: true, message: `Clicked element [${index}]` };
  }

  private async typeText(index: number, text: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await this.performOnElement(index, async (p, targetIndex, selectors) => {
      await p.evaluate(
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
        { sel: selectors, idx: targetIndex }
      );
    });
    await page.keyboard.type(text, { delay: 30 });
    return { success: true, message: `Typed "${text}" into element [${index}]` };
  }

  private async selectOption(index: number, value: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await this.performOnElement(index, async (p, targetIndex, selectors) => {
      await p.evaluate(
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
            if (visibleIndex === idx && el.tagName.toLowerCase() === 'select') {
              (el as HTMLSelectElement).value = val;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            }
          }
        },
        { sel: selectors, idx: targetIndex, val: value }
      );
    });
    return { success: true, message: `Selected option "${value}" on element [${index}]` };
  }

  private async hover(index: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await this.performOnElement(index, async (p, targetIndex, selectors) => {
      await p.evaluate(
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
              el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              return;
            }
          }
        },
        { sel: selectors, idx: targetIndex }
      );
    });
    return { success: true, message: `Hovered over element [${index}]` };
  }

  private async scroll(direction: 'up' | 'down', amount?: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const pixels = amount ?? 500;
    const delta = direction === 'down' ? pixels : -pixels;
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    return { success: true, message: `Scrolled ${direction} by ${pixels}px` };
  }

  private async goTo(url: string): Promise<ActionResult> {
    await this.engine.goto(url);
    return { success: true, message: `Navigated to ${url}` };
  }

  private async goBack(): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    return { success: true, message: 'Went back to previous page' };
  }

  private async waitForLoad(timeout?: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    await page.waitForLoadState('networkidle', { timeout: timeout ?? 10000 });
    return { success: true, message: 'Page load complete' };
  }

  private async screenshot(filePath?: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const resolvedPath = filePath ?? path.join(os.tmpdir(), `brmonk-screenshot-${Date.now()}.png`);
    await page.screenshot({ path: resolvedPath, fullPage: false });
    return { success: true, message: `Screenshot saved to ${resolvedPath}`, data: resolvedPath };
  }

  private async getPageContent(): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const snapshot = await extractDOM(page);
    return { success: true, message: snapshot.textRepresentation };
  }

  private async evaluateScript(script: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const result = await page.evaluate((s) => {
      const fn = new Function(s);
      return fn();
    }, script);
    return { success: true, message: `Script result: ${JSON.stringify(result)}`, data: result };
  }

  private async newTab(url?: string): Promise<ActionResult> {
    await this.engine.newTab(url);
    return { success: true, message: `Opened new tab${url ? ` at ${url}` : ''}` };
  }

  private async switchTabAction(index: number): Promise<ActionResult> {
    await this.engine.switchTab(index);
    return { success: true, message: `Switched to tab ${index}` };
  }

  private async done(result: string): Promise<ActionResult> {
    this.taskDone = true;
    this.taskResult = result;
    return { success: true, message: `Task completed: ${result}` };
  }

  private async fail(reason: string): Promise<ActionResult> {
    this.taskFailed = true;
    this.taskResult = reason;
    return { success: false, message: `Task failed: ${reason}` };
  }

  private async dismissPopupsAction(): Promise<ActionResult> {
    const dismissed = await this.engine.dismissPopups();
    if (dismissed.length === 0) {
      return { success: true, message: 'No popups found to dismiss' };
    }
    return { success: true, message: `Dismissed: ${dismissed.join('; ')}` };
  }

  private async waitForUserAction(message: string): Promise<ActionResult> {
    await this.engine.waitForUserAction(message);
    return { success: true, message: `User completed: ${message}` };
  }

  private async extractTextAction(selector?: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const text = await page.evaluate((sel) => {
      const el = sel ? document.querySelector(sel) : document.body;
      return (el as HTMLElement | null)?.innerText?.slice(0, 5000) ?? '';
    }, selector ?? null);
    return { success: true, message: text };
  }

  private async fillFormFieldAction(label: string, value: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const filled = await page.evaluate(({ lbl, val }) => {
      const lowerLabel = lbl.toLowerCase();

      // Find label element matching the text
      const labels = document.querySelectorAll('label');
      for (const labelEl of labels) {
        const labelText = (labelEl.textContent || '').trim().toLowerCase();
        if (!labelText.includes(lowerLabel)) continue;

        const forId = labelEl.getAttribute('for');
        let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null = null;
        if (forId) {
          input = document.getElementById(forId) as HTMLInputElement | null;
        }
        if (!input) {
          input = labelEl.querySelector('input, textarea, select');
        }
        if (input) {
          if (input.tagName.toLowerCase() === 'select') {
            (input as HTMLSelectElement).value = val;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            (input as HTMLInputElement).value = '';
            input.focus();
            (input as HTMLInputElement).value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        }
      }

      // Fallback: find by placeholder or aria-label
      const inputs = document.querySelectorAll('input, textarea, select');
      for (const inp of inputs) {
        const el = inp as HTMLInputElement;
        const ph = (el.placeholder || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const name = (el.name || '').toLowerCase();
        if (ph.includes(lowerLabel) || aria.includes(lowerLabel) || name.includes(lowerLabel)) {
          el.value = '';
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, { lbl: label, val: value });

    if (filled) {
      return { success: true, message: `Filled "${label}" with "${value}"` };
    }
    return { success: false, message: `Could not find form field matching "${label}"` };
  }

  private async clickByTextAction(text: string): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const clicked = await page.evaluate((targetText) => {
      const lowerTarget = targetText.toLowerCase();
      const candidates = document.querySelectorAll('a, button, [role="button"], [role="link"], [onclick], input[type="submit"], input[type="button"]');
      for (const node of candidates) {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        if (!visible) continue;

        const elText = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const val = ((el as HTMLInputElement).value || '').toLowerCase();
        if (elText.includes(lowerTarget) || aria.includes(lowerTarget) || val.includes(lowerTarget)) {
          el.click();
          return true;
        }
      }
      return false;
    }, text);

    if (clicked) {
      await page.waitForTimeout(500);
      return { success: true, message: `Clicked element containing "${text}"` };
    }
    return { success: false, message: `No clickable element found with text "${text}"` };
  }

  private async scrollToElementAction(index: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [role="listbox"], [role="option"], [role="searchbox"], [onclick], [tabindex], summary, details, [contenteditable], [draggable="true"], label[for]';
    await page.evaluate(
      ({ sel, idx }) => {
        const nodes = document.querySelectorAll(sel);
        let visibleIndex = 0;
        for (const node of nodes) {
          const el = node as HTMLElement;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          if (!visible) continue;
          visibleIndex++;
          if (visibleIndex === idx) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
        }
      },
      { sel: selectors, idx: index }
    );
    return { success: true, message: `Scrolled to element [${index}]` };
  }

  private async waitForElementAction(text: string, timeout?: number): Promise<ActionResult> {
    const page = this.engine.currentPage();
    const maxWait = timeout ?? 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const found = await page.evaluate((t) => {
        const lower = t.toLowerCase();
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const elText = (el.textContent || '').trim().toLowerCase();
          if (elText.includes(lower)) {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return true;
          }
        }
        return false;
      }, text);

      if (found) {
        return { success: true, message: `Element with text "${text}" found` };
      }
      await page.waitForTimeout(500);
    }

    return { success: false, message: `Element with text "${text}" not found within ${maxWait}ms` };
  }
}

export function getBrowserToolDefinitions(): LLMToolDefinition[] {
  return [
    {
      name: 'click',
      description: 'Click on an interactive element by its index number',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The index number of the element to click, as shown in [N] labels' },
        },
        required: ['index'],
      },
    },
    {
      name: 'type',
      description: 'Type text into an input element. Clears existing value first.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The index number of the input element' },
          text: { type: 'string', description: 'The text to type' },
        },
        required: ['index', 'text'],
      },
    },
    {
      name: 'selectOption',
      description: 'Select an option from a dropdown/select element',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The index number of the select element' },
          value: { type: 'string', description: 'The value to select' },
        },
        required: ['index', 'value'],
      },
    },
    {
      name: 'hover',
      description: 'Hover over an element to trigger hover effects',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The index number of the element to hover over' },
        },
        required: ['index'],
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: 'Direction to scroll' },
          amount: { type: 'number', description: 'Pixels to scroll (default 500)' },
        },
        required: ['direction'],
      },
    },
    {
      name: 'goTo',
      description: 'Navigate to a specific URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to navigate to' },
        },
        required: ['url'],
      },
    },
    {
      name: 'goBack',
      description: 'Go back to the previous page in browser history',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'waitForLoad',
      description: 'Wait for the page to finish loading (network idle)',
      parameters: {
        type: 'object',
        properties: {
          timeout: { type: 'number', description: 'Max wait time in milliseconds (default 10000)' },
        },
      },
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot of the current page',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to save screenshot (optional, auto-generated if omitted)' },
        },
      },
    },
    {
      name: 'getPageContent',
      description: 'Get the full text content and interactive elements of the current page',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'evaluate',
      description: 'Execute JavaScript code in the page context',
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['script'],
      },
    },
    {
      name: 'newTab',
      description: 'Open a new browser tab, optionally navigating to a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open in the new tab (optional)' },
        },
      },
    },
    {
      name: 'switchTab',
      description: 'Switch to a different browser tab by index',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The tab index to switch to (0-based)' },
        },
        required: ['index'],
      },
    },
    {
      name: 'done',
      description: 'Signal that the task is complete and provide the result. Call this when you have accomplished the user\'s task.',
      parameters: {
        type: 'object',
        properties: {
          result: { type: 'string', description: 'Description of what was accomplished and any extracted data' },
        },
        required: ['result'],
      },
    },
    {
      name: 'fail',
      description: 'Signal that the task cannot be completed. Call this when you are unable to accomplish the task after reasonable attempts.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the task failed' },
        },
        required: ['reason'],
      },
    },
    {
      name: 'dismissPopups',
      description: 'Actively dismiss any visible popups, cookie banners, or overlay modals on the page',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'waitForUser',
      description: 'Pause execution and ask the user to perform an action manually in the browser (e.g., solve a CAPTCHA, log in)',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to show the user explaining what they need to do' },
        },
        required: ['message'],
      },
    },
    {
      name: 'extractText',
      description: 'Extract text content from a specific area of the page using a CSS selector, or the entire page if no selector given',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to extract text from (optional, defaults to body)' },
        },
      },
    },
    {
      name: 'fillFormField',
      description: 'Fill a form field by its label text rather than index. Matches against label elements, placeholders, and aria-labels.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The label text of the form field to fill' },
          value: { type: 'string', description: 'The value to fill in' },
        },
        required: ['label', 'value'],
      },
    },
    {
      name: 'clickByText',
      description: 'Click a button or link by its visible text content',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The visible text of the element to click' },
        },
        required: ['text'],
      },
    },
    {
      name: 'scrollToElement',
      description: 'Scroll a specific interactive element into the center of the viewport',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The index number of the element to scroll to' },
        },
        required: ['index'],
      },
    },
    {
      name: 'waitForElement',
      description: 'Wait for an element containing specific text to appear on the page',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to wait for' },
          timeout: { type: 'number', description: 'Max wait time in ms (default 10000)' },
        },
        required: ['text'],
      },
    },
  ];
}
