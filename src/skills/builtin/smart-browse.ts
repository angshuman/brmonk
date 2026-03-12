import type { Skill, SkillContext } from '../types.js';
import { extractDOM } from '../../browser/dom.js';

export const smartBrowseSkill: Skill = {
  name: 'smart-browse',
  description: 'Advanced browsing for multi-page research, product comparison, and complex workflows',
  version: '1.0.0',
  systemPrompt: `You can perform advanced browsing tasks:
- researchTopic: Deep multi-page research with summarization
- compareProducts: Visit multiple product pages and compare them
- multiStepWorkflow: Execute a sequence of browse-and-extract steps
Use these for complex tasks that require visiting multiple pages and synthesizing information.`,
  tools: [
    {
      name: 'researchTopic',
      description: 'Perform multi-page research on a topic by searching, visiting pages, and summarizing findings',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The topic to research' },
          depth: { type: 'number', description: 'Number of pages to visit (default 3, max 10)' },
        },
        required: ['topic'],
      },
    },
    {
      name: 'compareProducts',
      description: 'Visit multiple product/service URLs and create a comparison',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of URLs to compare',
          },
        },
        required: ['urls'],
      },
    },
    {
      name: 'multiStepWorkflow',
      description: 'Execute a sequence of browse-and-extract steps, passing data between them',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', description: 'Action to perform' },
                params: { type: 'object', description: 'Parameters for the action' },
              },
              required: ['action'],
            },
            description: 'Array of step objects with "action" and "params" fields',
          },
        },
        required: ['steps'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'researchTopic':
        return await researchTopic(args, context);
      case 'compareProducts':
        return await compareProducts(args, context);
      case 'multiStepWorkflow':
        return await multiStepWorkflow(args, context);
      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};

async function researchTopic(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const topic = args['topic'] as string;
  if (!topic) return 'Error: topic is required';
  const depth = Math.min(Math.max((args['depth'] as number) ?? 3, 1), 10);

  const page = context.browser.currentPage();

  // Search for the topic
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(topic)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Extract search result URLs
  const searchResults = await page.evaluate(() => {
    const items: Array<{ title: string; url: string }> = [];
    const results = document.querySelectorAll('div.g');
    results.forEach((result) => {
      const titleEl = result.querySelector('h3');
      const linkEl = result.querySelector('a');
      if (titleEl && linkEl) {
        const href = linkEl.getAttribute('href') ?? '';
        if (href.startsWith('http')) {
          items.push({
            title: titleEl.textContent ?? '',
            url: href,
          });
        }
      }
    });
    return items.slice(0, 10);
  });

  if (searchResults.length === 0) {
    return `No search results found for "${topic}"`;
  }

  // Visit top pages and extract content
  const pagesToVisit = searchResults.slice(0, depth);
  const findings: string[] = [];

  for (const result of pagesToVisit) {
    try {
      await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1000);

      const content = await page.evaluate(() => {
        return document.body.innerText.slice(0, 3000);
      });

      findings.push(`### ${result.title}\nURL: ${result.url}\n\n${content.slice(0, 1500)}`);
    } catch {
      findings.push(`### ${result.title}\nURL: ${result.url}\n\n(Could not load page)`);
    }
  }

  // Summarize findings
  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Summarize the following research findings about "${topic}". Provide a clear, organized summary with key points and insights. Be concise but comprehensive.`,
    },
    { role: 'user', content: findings.join('\n\n---\n\n') },
  ], { temperature: 0.3, maxTokens: 1500 });

  return `Research on "${topic}" (${pagesToVisit.length} sources):\n\n${response.content ?? 'Could not generate summary.'}`;
}

async function compareProducts(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const urls = args['urls'] as string[] | undefined;
  if (!urls || urls.length === 0) return 'Error: urls array is required';

  const page = context.browser.currentPage();
  const products: Array<{ url: string; title: string; content: string }> = [];

  for (const url of urls.slice(0, 5)) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(1000);

      const dom = await extractDOM(page);
      const content = await page.evaluate(() => {
        return document.body.innerText.slice(0, 3000);
      });

      products.push({
        url,
        title: dom.title,
        content: content.slice(0, 2000),
      });
    } catch {
      products.push({ url, title: 'Could not load', content: '(Page failed to load)' });
    }
  }

  // Use LLM to compare
  const productDescriptions = products.map((p, i) =>
    `PRODUCT ${i + 1}: ${p.title}\nURL: ${p.url}\n${p.content}`
  ).join('\n\n---\n\n');

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Compare these products/services. Create a structured comparison covering:
1. Key features of each
2. Pricing (if available)
3. Pros and cons
4. Recommendation
Present in a clear, easy-to-read format.`,
    },
    { role: 'user', content: productDescriptions },
  ], { temperature: 0.3, maxTokens: 1500 });

  return `Comparison of ${products.length} products:\n\n${response.content ?? 'Could not generate comparison.'}`;
}

interface WorkflowStep {
  action: string;
  params: Record<string, unknown>;
}

async function multiStepWorkflow(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const steps = args['steps'] as WorkflowStep[] | undefined;
  if (!steps || steps.length === 0) return 'Error: steps array is required';

  const page = context.browser.currentPage();
  const results: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    try {
      switch (step.action) {
        case 'navigate': {
          const url = step.params['url'] as string;
          if (url) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(1000);
            results.push(`Step ${i + 1}: Navigated to ${url}`);
          }
          break;
        }
        case 'extract': {
          const selector = step.params['selector'] as string | undefined;
          const text = await page.evaluate((sel) => {
            const el = sel ? document.querySelector(sel) : document.body;
            return (el as HTMLElement | null)?.innerText?.slice(0, 3000) ?? '';
          }, selector ?? null);
          results.push(`Step ${i + 1}: Extracted text (${text.length} chars):\n${text.slice(0, 1000)}`);
          break;
        }
        case 'click': {
          const clickText = step.params['text'] as string;
          if (clickText) {
            await page.evaluate((t) => {
              const lower = t.toLowerCase();
              const els = document.querySelectorAll('a, button, [role="button"]');
              for (const el of els) {
                if ((el.textContent || '').toLowerCase().includes(lower)) {
                  (el as HTMLElement).click();
                  return;
                }
              }
            }, clickText);
            await page.waitForTimeout(1000);
            results.push(`Step ${i + 1}: Clicked "${clickText}"`);
          }
          break;
        }
        case 'wait': {
          const ms = (step.params['ms'] as number) ?? 1000;
          await page.waitForTimeout(ms);
          results.push(`Step ${i + 1}: Waited ${ms}ms`);
          break;
        }
        case 'screenshot': {
          const dom = await extractDOM(page);
          results.push(`Step ${i + 1}: Page state: ${dom.title} (${dom.url})`);
          break;
        }
        default:
          results.push(`Step ${i + 1}: Unknown action "${step.action}"`);
      }
    } catch (err) {
      results.push(`Step ${i + 1}: Error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return `Workflow completed (${steps.length} steps):\n\n${results.join('\n')}`;
}
