import type { Skill, SkillContext } from '../types.js';
import { extractDOM } from '../../browser/dom.js';

export const webSearchSkill: Skill = {
  name: 'web-search',
  description: 'Search the web using the browser and extract results',
  version: '1.0.0',
  systemPrompt: `You can search the web using searchWeb(query) to navigate to a search engine, enter a query, and extract the results. Use searchAndSummarize(query) to search and get a concise summary of the top results.`,
  tools: [
    {
      name: 'searchWeb',
      description: 'Search the web by navigating to Google and entering a query. Returns a list of search results with titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'searchAndSummarize',
      description: 'Search the web and return a concise summary of the top results',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    const query = args['query'] as string;
    if (!query) return 'Error: query is required';

    const page = context.browser.currentPage();

    // Navigate to Google
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Extract search results
    const results = await page.evaluate(() => {
      const items: Array<{ title: string; url: string; snippet: string }> = [];
      const searchResults = document.querySelectorAll('div.g');
      searchResults.forEach((result) => {
        const titleEl = result.querySelector('h3');
        const linkEl = result.querySelector('a');
        const snippetEl = result.querySelector('div[data-sncf]') ?? result.querySelector('.VwiC3b');
        if (titleEl && linkEl) {
          items.push({
            title: titleEl.textContent ?? '',
            url: linkEl.getAttribute('href') ?? '',
            snippet: snippetEl?.textContent ?? '',
          });
        }
      });
      return items.slice(0, 10);
    });

    if (toolName === 'searchWeb') {
      if (results.length === 0) {
        const dom = await extractDOM(page);
        return `Search completed but no structured results found. Page content:\n${dom.textSummary}`;
      }
      return results.map((r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
      ).join('\n\n');
    }

    // searchAndSummarize
    if (results.length === 0) {
      return `No results found for "${query}"`;
    }

    const summary = results.slice(0, 5).map((r, i) =>
      `${i + 1}. **${r.title}**: ${r.snippet}`
    ).join('\n');

    return `Search results for "${query}":\n\n${summary}`;
  },
};
