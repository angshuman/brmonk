import type { Page } from 'playwright';

export interface DOMElement {
  index: number;
  tag: string;
  text: string;
  href: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  role: string | null;
  type: string | null;
  value: string | null;
  name: string | null;
  required: boolean;
  formGroup: string | null;
}

export interface DOMSnapshot {
  url: string;
  title: string;
  textSummary: string;
  elements: DOMElement[];
  elementMap: Map<number, DOMElement>;
  textRepresentation: string;
  headings: string[];
  forms: FormInfo[];
}

export interface FormInfo {
  action: string | null;
  method: string | null;
  fields: { name: string | null; type: string | null; label: string | null; required: boolean }[];
}

export interface PageContent {
  title: string;
  url: string;
  headings: { level: number; text: string }[];
  mainText: string;
  forms: FormInfo[];
  links: { text: string; href: string }[];
}

const MAX_ELEMENTS = 50;

const INTERACTIVE_SELECTORS = [
  'a', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
  '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="searchbox"]',
  '[onclick]', '[tabindex]',
  'summary', 'details', '[contenteditable]', '[draggable="true"]',
  'label[for]',
].join(', ');

export async function extractDOM(page: Page): Promise<DOMSnapshot> {
  const url = page.url();
  const title = await page.title();

  const extracted = await page.evaluate((selectors: string) => {
    const body = document.body;
    if (!body) return { textSummary: '', rawElements: [] as Array<{
      tag: string; text: string; href: string | null; placeholder: string | null;
      ariaLabel: string | null; role: string | null; type: string | null;
      value: string | null; name: string | null; required: boolean; formGroup: string | null;
      inViewport: boolean;
    }>, headings: [] as string[], forms: [] as Array<{ action: string | null; method: string | null; fields: Array<{ name: string | null; type: string | null; label: string | null; required: boolean }> }>, totalCount: 0 };

    // Extract text summary
    const text = body.innerText || '';
    const textSummary = text.slice(0, 2000);

    // Extract headings
    const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const headings: string[] = [];
    headingEls.forEach((h) => {
      const hText = (h.textContent || '').trim();
      if (hText) headings.push(`${h.tagName}: ${hText.slice(0, 100)}`);
    });

    // Extract form structures
    const formEls = document.querySelectorAll('form');
    const forms: Array<{
      action: string | null;
      method: string | null;
      fields: Array<{ name: string | null; type: string | null; label: string | null; required: boolean }>;
    }> = [];

    formEls.forEach((form) => {
      const fields: Array<{ name: string | null; type: string | null; label: string | null; required: boolean }> = [];
      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach((input) => {
        const el = input as HTMLInputElement;
        const inputId = el.id;
        let label: string | null = null;
        if (inputId) {
          const labelEl = form.querySelector(`label[for="${inputId}"]`);
          if (labelEl) label = (labelEl.textContent || '').trim();
        }
        if (!label) {
          const parent = el.closest('label');
          if (parent) label = (parent.textContent || '').trim().slice(0, 50);
        }
        fields.push({
          name: el.getAttribute('name'),
          type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
          label: label ?? el.getAttribute('placeholder') ?? el.getAttribute('aria-label'),
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        });
      });
      forms.push({
        action: form.getAttribute('action'),
        method: form.getAttribute('method'),
        fields,
      });
    });

    // Extract interactive elements
    const nodes = document.querySelectorAll(selectors);
    const viewportHeight = window.innerHeight;
    const rawElements: Array<{
      tag: string; text: string; href: string | null; placeholder: string | null;
      ariaLabel: string | null; role: string | null; type: string | null;
      value: string | null; name: string | null; required: boolean; formGroup: string | null;
      inViewport: boolean;
    }> = [];

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0';

      if (!visible) return;

      const inViewport = rect.top < viewportHeight && rect.bottom > 0;

      // Find form group / label
      let formGroup: string | null = null;
      const closestLabel = el.closest('label');
      if (closestLabel) {
        formGroup = (closestLabel.textContent || '').trim().slice(0, 50);
      } else if ((el as HTMLInputElement).id) {
        const lbl = document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
        if (lbl) formGroup = (lbl.textContent || '').trim().slice(0, 50);
      }

      const elText = (el.textContent || '').trim().slice(0, 100);
      rawElements.push({
        tag: el.tagName.toLowerCase(),
        text: elText,
        href: el.getAttribute('href'),
        placeholder: el.getAttribute('placeholder'),
        ariaLabel: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        type: el.getAttribute('type'),
        value: (el as HTMLInputElement).value || el.getAttribute('value'),
        name: el.getAttribute('name'),
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        formGroup,
        inViewport,
      });
    });

    return { textSummary, rawElements, headings, forms, totalCount: rawElements.length };
  }, INTERACTIVE_SELECTORS);

  // Prioritize viewport elements, then cap at MAX_ELEMENTS
  const viewportElements = extracted.rawElements.filter(e => e.inViewport);
  const belowFoldElements = extracted.rawElements.filter(e => !e.inViewport);
  const combined = [...viewportElements, ...belowFoldElements];
  const capped = combined.slice(0, MAX_ELEMENTS);
  const overflowCount = extracted.totalCount - capped.length;

  const elements: DOMElement[] = [];
  const elementMap = new Map<number, DOMElement>();

  capped.forEach((raw, i) => {
    const index = i + 1;
    const { inViewport: _iv, ...rest } = raw;
    const element: DOMElement = { index, ...rest };
    elements.push(element);
    elementMap.set(index, element);
  });

  // Build text representation
  const lines: string[] = [];
  lines.push(`Page: ${title}`);
  lines.push(`URL: ${url}`);
  lines.push('');

  if (extracted.headings.length > 0) {
    lines.push('Page Structure:');
    for (const h of extracted.headings.slice(0, 10)) {
      lines.push(`  ${h}`);
    }
    lines.push('');
  }

  if (extracted.forms.length > 0) {
    lines.push('Forms:');
    for (let i = 0; i < extracted.forms.length; i++) {
      const form = extracted.forms[i];
      if (!form) continue;
      lines.push(`  Form ${i + 1}: ${form.action ?? '(no action)'} [${form.method ?? 'GET'}]`);
      for (const field of form.fields) {
        const req = field.required ? ' *REQUIRED*' : '';
        lines.push(`    - ${field.label ?? field.name ?? '(unnamed)'} [${field.type}]${req}`);
      }
    }
    lines.push('');
  }

  lines.push('Interactive Elements:');
  for (const el of elements) {
    const parts: string[] = [`[${el.index}]`, `<${el.tag}>`];
    if (el.type) parts.push(`type="${el.type}"`);
    if (el.role) parts.push(`role="${el.role}"`);
    if (el.text) parts.push(`"${el.text}"`);
    if (el.href) parts.push(`href="${el.href}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
    if (el.value) parts.push(`value="${el.value}"`);
    if (el.name) parts.push(`name="${el.name}"`);
    if (el.required) parts.push('*REQUIRED*');
    if (el.formGroup) parts.push(`label="${el.formGroup}"`);
    lines.push(parts.join(' '));
  }

  if (overflowCount > 0) {
    lines.push(`(and ${overflowCount} more elements below the fold)`);
  }

  lines.push('');
  lines.push('Page Content (summary):');
  lines.push(extracted.textSummary);

  return {
    url,
    title,
    textSummary: extracted.textSummary,
    elements,
    elementMap,
    textRepresentation: lines.join('\n'),
    headings: extracted.headings,
    forms: extracted.forms,
  };
}

export async function getStructuredContent(page: Page): Promise<PageContent> {
  const title = await page.title();
  const url = page.url();

  const data = await page.evaluate(() => {
    const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const headings: Array<{ level: number; text: string }> = [];
    headingEls.forEach(h => {
      const level = parseInt(h.tagName.charAt(1));
      const text = (h.textContent || '').trim();
      if (text) headings.push({ level, text: text.slice(0, 200) });
    });

    const mainEl = document.querySelector('main') ?? document.querySelector('[role="main"]') ?? document.body;
    const mainText = (mainEl?.innerText || '').slice(0, 5000);

    const formEls = document.querySelectorAll('form');
    const forms: Array<{
      action: string | null; method: string | null;
      fields: Array<{ name: string | null; type: string | null; label: string | null; required: boolean }>;
    }> = [];
    formEls.forEach(form => {
      const fields: Array<{ name: string | null; type: string | null; label: string | null; required: boolean }> = [];
      form.querySelectorAll('input, select, textarea').forEach(input => {
        const el = input as HTMLInputElement;
        const inputId = el.id;
        let label: string | null = null;
        if (inputId) {
          const labelEl = document.querySelector(`label[for="${inputId}"]`);
          if (labelEl) label = (labelEl.textContent || '').trim();
        }
        fields.push({
          name: el.getAttribute('name'),
          type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
          label: label ?? el.getAttribute('placeholder'),
          required: el.hasAttribute('required'),
        });
      });
      forms.push({ action: form.getAttribute('action'), method: form.getAttribute('method'), fields });
    });

    const linkEls = document.querySelectorAll('a[href]');
    const links: Array<{ text: string; href: string }> = [];
    linkEls.forEach(a => {
      const text = (a.textContent || '').trim().slice(0, 100);
      const href = a.getAttribute('href') || '';
      if (text && href) links.push({ text, href });
    });

    return { headings, mainText, forms, links: links.slice(0, 100) };
  });

  return { title, url, ...data };
}
