import type { Skill, SkillContext } from '../types.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';

export const documentsSkill: Skill = {
  name: 'documents',
  description: 'Import, parse, and manage user documents — resumes, requirements lists, portfolios, wish lists',
  version: '1.0.0',
  systemPrompt: `You help users manage their documents. Documents provide context for matching against tracked items. Use importDocument to add a new document from text or file, listDocuments to see all documents, and parseDocument to extract structured data from a document using AI.`,
  tools: [
    {
      name: 'importDocument',
      description: 'Import a document from text content or a file path',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable name (e.g. "My Resume", "Apartment Requirements")' },
          type: { type: 'string', description: 'Document type: resume, requirements, portfolio, wishlist, or custom' },
          content: { type: 'string', description: 'Raw text content of the document' },
          filePath: { type: 'string', description: 'Path to a text file to import (alternative to content)' },
        },
        required: ['name', 'type'],
      },
    },
    {
      name: 'listDocuments',
      description: 'List all stored documents',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Filter by document type' },
        },
      },
    },
    {
      name: 'parseDocument',
      description: 'Use AI to extract structured data from a stored document',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the document to parse' },
        },
        required: ['documentId'],
      },
    },
    {
      name: 'deleteDocument',
      description: 'Delete a stored document',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the document to delete' },
        },
        required: ['documentId'],
      },
    },
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: SkillContext): Promise<string> {
    switch (toolName) {
      case 'importDocument':
        return await importDocument(args, context);
      case 'listDocuments':
        return await listDocuments(args, context);
      case 'parseDocument':
        return await parseDocument(args, context);
      case 'deleteDocument':
        return await deleteDocument(args, context);
      default:
        return `Unknown tool: ${toolName}`;
    }
  },
};

async function importDocument(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const name = args['name'] as string;
  const type = args['type'] as string;
  let content = args['content'] as string | undefined;
  const filePath = args['filePath'] as string | undefined;

  if (!name || !type) return 'Error: name and type are required';

  if (!content && filePath) {
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (!content || !content.trim()) {
    return 'Error: no content provided. Specify content or a filePath.';
  }

  const docId = crypto.randomUUID().slice(0, 8);
  await context.memory.saveDocument({
    id: docId,
    name,
    type,
    content,
    updatedAt: Date.now(),
  });

  return `Document imported: "${name}" (${type}, ${content.length} chars)\nID: ${docId}`;
}

async function listDocuments(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const type = args['type'] as string | undefined;
  const docs = await context.memory.getDocuments(type);

  if (docs.length === 0) {
    return 'No documents found.';
  }

  const lines = [`Documents (${docs.length}):\n`];
  for (const doc of docs) {
    const date = new Date(doc.updatedAt).toLocaleDateString();
    lines.push(`  [${doc.id}] ${doc.name} (${doc.type}) — ${doc.content.length} chars — ${date}`);
  }

  return lines.join('\n');
}

async function parseDocument(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const documentId = args['documentId'] as string;
  if (!documentId) return 'Error: documentId is required';

  const doc = await context.memory.getDocument(documentId);
  if (!doc) return `Error: document not found: ${documentId}`;

  const response = await context.llm.chat([
    {
      role: 'system',
      content: `Extract structured data from this document. Return ONLY valid JSON with relevant fields.
For a resume: name, email, skills, experience, education.
For requirements: criteria, must-haves, nice-to-haves.
For any document: extract the most relevant structured information.`,
    },
    { role: 'user', content: doc.content.slice(0, 5000) },
  ], { temperature: 0.1, maxTokens: 2048 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.content ?? '{}') as Record<string, unknown>;
  } catch {
    parsed = { raw: response.content ?? '' };
  }

  doc.parsed = parsed;
  doc.updatedAt = Date.now();
  await context.memory.saveDocument(doc);

  return `Parsed "${doc.name}" (${doc.type}):\n${JSON.stringify(parsed, null, 2)}`;
}

async function deleteDocument(args: Record<string, unknown>, context: SkillContext): Promise<string> {
  const documentId = args['documentId'] as string;
  if (!documentId) return 'Error: documentId is required';

  const doc = await context.memory.getDocument(documentId);
  if (!doc) return `Error: document not found: ${documentId}`;

  await context.memory.deleteDocument(documentId);
  return `Deleted document: "${doc.name}" (${doc.type})`;
}
