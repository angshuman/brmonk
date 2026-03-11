import type { Skill, SkillContext } from '../types.js';

export const dataExtractSkill: Skill = {
  name: 'data-extract',
  description: 'Extract structured data from web pages',
  version: '1.0.0',
  systemPrompt: `You can extract structured data from the current page using:
- extractTable(): Extract tabular data from HTML tables on the page
- extractLinks(): Extract all links from the page with their text and URLs
- extractData(schema): Extract custom data based on a JSON schema description`,
  tools: [
    {
      name: 'extractTable',
      description: 'Extract all tables from the current page as structured data',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'extractLinks',
      description: 'Extract all links from the current page with their text and URLs',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'extractData',
      description: 'Extract custom structured data from the page based on a schema description',
      parameters: {
        type: 'object',
        properties: {
          schema: { type: 'string', description: 'A description of what data to extract (e.g., "product names and prices", "article titles and dates")' },
        },
        required: ['schema'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    const page = context.browser.currentPage();

    switch (toolName) {
      case 'extractTable': {
        const tables = await page.evaluate(() => {
          const results: Array<{ headers: string[]; rows: string[][] }> = [];
          document.querySelectorAll('table').forEach((table) => {
            const headers: string[] = [];
            table.querySelectorAll('th').forEach((th) => {
              headers.push((th.textContent ?? '').trim());
            });
            const rows: string[][] = [];
            table.querySelectorAll('tr').forEach((tr) => {
              const cells: string[] = [];
              tr.querySelectorAll('td').forEach((td) => {
                cells.push((td.textContent ?? '').trim());
              });
              if (cells.length > 0) rows.push(cells);
            });
            if (rows.length > 0) results.push({ headers, rows });
          });
          return results;
        });

        if (tables.length === 0) return 'No tables found on the page.';

        return tables.map((table, i) => {
          let output = `Table ${i + 1}:\n`;
          if (table.headers.length > 0) {
            output += `Headers: ${table.headers.join(' | ')}\n`;
          }
          table.rows.forEach((row, j) => {
            output += `Row ${j + 1}: ${row.join(' | ')}\n`;
          });
          return output;
        }).join('\n');
      }

      case 'extractLinks': {
        const links = await page.evaluate(() => {
          const results: Array<{ text: string; href: string }> = [];
          document.querySelectorAll('a[href]').forEach((a) => {
            const text = (a.textContent ?? '').trim();
            const href = a.getAttribute('href') ?? '';
            if (text && href) {
              results.push({ text: text.slice(0, 100), href });
            }
          });
          return results.slice(0, 100);
        });

        if (links.length === 0) return 'No links found on the page.';

        return links.map((link, i) =>
          `${i + 1}. [${link.text}](${link.href})`
        ).join('\n');
      }

      case 'extractData': {
        const schema = args['schema'] as string;
        const pageContent = await page.evaluate(() => {
          return document.body?.innerText?.slice(0, 5000) ?? '';
        });

        // Use the LLM to extract structured data
        const response = await context.llm.chat([
          {
            role: 'system',
            content: 'You are a data extraction assistant. Extract the requested data from the page content and return it as JSON.',
          },
          {
            role: 'user',
            content: `Extract the following data from this page content:\n\nSchema: ${schema}\n\nPage content:\n${pageContent}\n\nReturn ONLY valid JSON.`,
          },
        ], { temperature: 0, maxTokens: 2048 });

        return response.content ?? 'No data extracted';
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};
