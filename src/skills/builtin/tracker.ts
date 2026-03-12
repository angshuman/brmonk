import type { Skill, SkillContext } from '../types.js';
import * as crypto from 'node:crypto';
import { extractDOM } from '../../browser/dom.js';
import type { TrackedItem } from '../../memory/types.js';

export const trackerSkill: Skill = {
  name: 'tracker',
  description: 'Track, organize, and match items found while browsing — jobs, listings, contracts, products, or anything else',
  version: '1.0.0',
  systemPrompt: `You can track items the user finds while browsing. Each item belongs to a collection (e.g. "jobs", "apartments", "contracts"). Use saveTrackedItem to save items from pages, listTrackedItems to review saved items, and matchItems to compare items against user documents.`,
  tools: [
    {
      name: 'saveTrackedItem',
      description: 'Extract and save a tracked item from the current page or a given URL. Auto-detects the collection type from content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the page to extract from (uses current page if omitted)' },
          collection: { type: 'string', description: 'Collection name (e.g. "jobs", "apartments"). Auto-detected if omitted.' },
          tags: { type: 'array', description: 'Optional tags to apply' },
        },
      },
    },
    {
      name: 'listTrackedItems',
      description: 'List tracked items with optional filtering by collection, status, tags, or search query',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Filter by collection name' },
          status: { type: 'string', description: 'Filter by status: new, saved, applied, rejected, archived' },
          query: { type: 'string', description: 'Search across titles, notes, and fields' },
          tags: { type: 'array', description: 'Filter by tags (must match all)' },
        },
      },
    },
    {
      name: 'matchItems',
      description: 'Match tracked items in a collection against a user document (e.g. match jobs against resume, apartments against requirements)',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection to match items from' },
          documentId: { type: 'string', description: 'ID of the user document to match against. Lists available documents if omitted.' },
        },
      },
    },
    {
      name: 'updateItemStatus',
      description: 'Update the status of a tracked item',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'ID of the item to update' },
          status: { type: 'string', description: 'New status: new, saved, applied, rejected, archived' },
          notes: { type: 'string', description: 'Optional notes to add' },
        },
        required: ['itemId', 'status'],
      },
    },
    {
      name: 'getCollections',
      description: 'List all collections and item counts',
      parameters: { type: 'object', properties: {} },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'saveTrackedItem':
        return await saveTrackedItem(args, context);
      case 'listTrackedItems':
        return await listTrackedItems(args, context);
      case 'matchItems':
        return await matchItems(args, context);
      case 'updateItemStatus':
        return await updateItemStatus(args, context);
      case 'getCollections':
        return await getCollections(context);
      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};

async function saveTrackedItem(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const url = args['url'] as string | undefined;
  const collectionOverride = args['collection'] as string | undefined;
  const tagsOverride = args['tags'] as string[] | undefined;

  const page = context.browser.currentPage();

  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
  }

  const content = await page.evaluate(() => {
    return document.body.innerText.slice(0, 8000);
  });

  const dom = await extractDOM(page);
  const pageTitle = dom.title;
  const pageUrl = page.url();

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Extract structured information from this page. Return ONLY valid JSON:
{
  "title": "Primary title/name of this item",
  "collection": "category like 'jobs', 'apartments', 'products', 'contracts', 'articles' etc.",
  "fields": { ... any relevant key-value pairs extracted from the content ... },
  "tags": ["relevant", "tags"]
}
The fields object should contain whatever structured data is relevant for this type of content.
For a job: company, location, salary, requirements, etc.
For a listing: price, location, features, etc.
For a product: brand, price, rating, specs, etc.`,
    },
    { role: 'user', content: `Page title: ${pageTitle}\n\nContent:\n${content}` },
  ], { temperature: 0.1, maxTokens: 1024 });

  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(response.content ?? '{}') as Record<string, unknown>;
  } catch {
    extracted = { title: pageTitle, collection: 'general', fields: {}, tags: [] };
  }

  const item: TrackedItem = {
    id: crypto.randomUUID().slice(0, 8),
    collection: collectionOverride ?? (extracted['collection'] as string) ?? 'general',
    title: (extracted['title'] as string) ?? pageTitle,
    url: pageUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'new',
    fields: (extracted['fields'] as Record<string, unknown>) ?? {},
    tags: tagsOverride ?? (extracted['tags'] as string[]) ?? [],
  };

  await context.memory.saveItem(item);

  return `Item tracked and saved:\n` +
    `Title: ${item.title}\n` +
    `Collection: ${item.collection}\n` +
    `Tags: ${item.tags.join(', ') || '(none)'}\n` +
    `Fields: ${JSON.stringify(item.fields, null, 2)}\n` +
    `ID: ${item.id}`;
}

async function listTrackedItems(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const items = await context.memory.getItems({
    collection: args['collection'] as string | undefined,
    status: args['status'] as TrackedItem['status'] | undefined,
    query: args['query'] as string | undefined,
    tags: args['tags'] as string[] | undefined,
  });

  if (items.length === 0) {
    return 'No tracked items found matching the filter.';
  }

  const lines = [`Found ${items.length} tracked items:\n`];
  for (const item of items) {
    const score = item.matchScore !== undefined ? ` · Score: ${item.matchScore}%` : '';
    lines.push(`[${item.status}] ${item.title}`);
    lines.push(`  Collection: ${item.collection} · Tags: ${item.tags.join(', ') || '(none)'}${score}`);
    lines.push(`  URL: ${item.url}`);
    if (item.notes) lines.push(`  Notes: ${item.notes}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function matchItems(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const collection = args['collection'] as string | undefined;
  const documentId = args['documentId'] as string | undefined;

  if (!documentId) {
    const docs = await context.memory.getDocuments();
    if (docs.length === 0) {
      return 'No documents found. Import a document first using the documents skill.';
    }
    return 'Available documents to match against:\n' +
      docs.map(d => `  [${d.id}] ${d.name} (${d.type})`).join('\n') +
      '\n\nSpecify a documentId to match items against.';
  }

  const doc = await context.memory.getDocument(documentId);
  if (!doc) {
    return `Document not found: ${documentId}`;
  }

  const items = await context.memory.getItems({ collection });
  if (items.length === 0) {
    return `No items found${collection ? ` in collection "${collection}"` : ''}.`;
  }

  const results: Array<{ item: TrackedItem; score: number; matched: string[]; missing: string[]; reasoning: string }> = [];

  for (const item of items) {
    const response = await context.llm.chat([
      {
        role: 'system',
        content: `Compare this item against the user's document and return ONLY valid JSON:
{
  "score": <0-100>,
  "matchedCriteria": ["criteria that match"],
  "missingCriteria": ["criteria that don't match"],
  "reasoning": "Brief explanation"
}`,
      },
      {
        role: 'user',
        content: `ITEM:\nTitle: ${item.title}\nCollection: ${item.collection}\nFields: ${JSON.stringify(item.fields)}\n\nDOCUMENT (${doc.type}):\n${doc.content.slice(0, 3000)}`,
      },
    ], { temperature: 0.2, maxTokens: 512 });

    let matchData: Record<string, unknown>;
    try {
      matchData = JSON.parse(response.content ?? '{}') as Record<string, unknown>;
    } catch {
      matchData = { score: 0, matchedCriteria: [], missingCriteria: [], reasoning: 'Could not analyze' };
    }

    const score = (matchData['score'] as number) ?? 0;
    item.matchScore = score;
    item.updatedAt = Date.now();
    await context.memory.saveItem(item);

    results.push({
      item,
      score,
      matched: (matchData['matchedCriteria'] as string[]) ?? [],
      missing: (matchData['missingCriteria'] as string[]) ?? [],
      reasoning: (matchData['reasoning'] as string) ?? '',
    });
  }

  results.sort((a, b) => b.score - a.score);

  const lines = [`Matched ${results.length} items against "${doc.name}" (${doc.type}):\n`];
  for (const r of results) {
    lines.push(`${r.item.title} — ${r.score}% match`);
    if (r.matched.length > 0) lines.push(`  Matched: ${r.matched.join(', ')}`);
    if (r.missing.length > 0) lines.push(`  Missing: ${r.missing.join(', ')}`);
    lines.push(`  ${r.reasoning}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function updateItemStatus(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const itemId = args['itemId'] as string;
  const status = args['status'] as TrackedItem['status'];
  const notes = args['notes'] as string | undefined;

  if (!itemId || !status) return 'Error: itemId and status are required';

  const validStatuses: TrackedItem['status'][] = ['new', 'saved', 'applied', 'rejected', 'archived'];
  if (!validStatuses.includes(status)) {
    return `Error: invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`;
  }

  const items = await context.memory.getItems();
  const item = items.find(i => i.id === itemId);
  if (!item) return `Error: item not found: ${itemId}`;

  item.status = status;
  item.updatedAt = Date.now();
  if (notes) item.notes = notes;

  await context.memory.saveItem(item);

  return `Updated item "${item.title}": status → ${status}${notes ? `, notes: ${notes}` : ''}`;
}

async function getCollections(context: SkillContext): Promise<string> {
  const collections = await context.memory.getCollections();
  if (collections.length === 0) {
    return 'No collections yet. Track some items first.';
  }

  const lines = ['Collections:\n'];
  for (const col of collections) {
    const items = await context.memory.getItems({ collection: col });
    lines.push(`  ${col}: ${items.length} items`);
  }

  return lines.join('\n');
}
