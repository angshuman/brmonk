import { Router } from 'express';
import * as crypto from 'node:crypto';
import type { ActiveSession } from './server.js';
import type { MemoryStore } from '../memory/store.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { Config } from '../config.js';
import { saveConfig } from '../config.js';

export function createApiRouter(
  sessions: Map<string, ActiveSession>,
  memory: MemoryStore,
  skillRegistry: SkillRegistry,
  config: Config,
): Router {
  const router = Router();

  // Sessions
  router.get('/sessions', async (_req, res) => {
    try {
      // Combine active sessions + stored session results
      const active = Array.from(sessions.values()).map(s => ({
        id: s.id,
        task: s.task,
        status: s.status,
        startedAt: s.startedAt,
        eventCount: s.events.length,
      }));

      const stored = await memory.getSessionResults(50);

      res.json({ active, stored });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/sessions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const active = sessions.get(id!);
      if (active) {
        return res.json({
          id: active.id,
          task: active.task,
          status: active.status,
          startedAt: active.startedAt,
          eventCount: active.events.length,
        });
      }
      const result = await memory.getSessionResult(id!);
      if (result) {
        return res.json(result);
      }
      return res.status(404).json({ error: 'Session not found' });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  router.get('/sessions/:id/events', (req, res) => {
    const { id } = req.params;
    const session = sessions.get(id!);
    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }
    return res.json(session.events);
  });

  router.get('/sessions/:id/screenshot', (req, res) => {
    const { id } = req.params;
    const session = sessions.get(id!);
    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }
    if (!session.latestScreenshot) {
      return res.status(404).json({ error: 'No screenshot available' });
    }
    return res.json(session.latestScreenshot);
  });

  // Profile
  router.get('/profile', async (_req, res) => {
    try {
      const profile = await memory.getProfile();
      res.json(profile ?? {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put('/profile', async (req, res) => {
    try {
      await memory.saveProfile(req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Memory
  router.get('/memory', async (req, res) => {
    try {
      const query = req.query['q'] as string | undefined;
      if (query) {
        const results = await memory.search(query);
        return res.json(results);
      }
      // Return all facts by category, each entry includes key field
      const categories = ['general', 'preferences', 'context'];
      const all: Record<string, unknown[]> = {};
      for (const cat of categories) {
        all[cat] = await memory.getByCategory(cat);
      }
      return res.json(all);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  router.get('/memory/documents', async (_req, res) => {
    try {
      const docs = await memory.getDocuments();
      res.json(docs);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/memory/documents', async (req, res) => {
    try {
      const { name, type, content } = req.body as { name: string; type: string; content: string };
      const id = crypto.randomUUID().slice(0, 8);
      await memory.saveDocument({ id, name, type, content, updatedAt: Date.now() });
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/memory/documents/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await memory.deleteDocument(id!);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/memory/notes', async (req, res) => {
    try {
      const { key, value, category } = req.body as { key: string; value: string; category?: string };
      await memory.remember(key, value, category);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/memory/notes/:key', async (req, res) => {
    try {
      const { key } = req.params;
      await memory.forget(key!);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Config
  router.get('/config', (_req, res) => {
    res.json(config);
  });

  router.put('/config', async (req, res) => {
    try {
      const updates = req.body as Record<string, unknown>;
      for (const [key, value] of Object.entries(updates)) {
        await saveConfig(key, String(value));
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Tracked Items
  router.get('/items', async (req, res) => {
    try {
      const filter: Record<string, unknown> = {};
      if (req.query['collection']) filter['collection'] = req.query['collection'];
      if (req.query['status']) filter['status'] = req.query['status'];
      if (req.query['query']) filter['query'] = req.query['query'];
      const items = await memory.getItems(Object.keys(filter).length > 0 ? filter as never : undefined);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/items/collections', async (_req, res) => {
    try {
      const collections = await memory.getCollections();
      const result: { name: string; count: number }[] = [];
      for (const name of collections) {
        const items = await memory.getItems({ collection: name });
        result.push({ name, count: items.length });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/items', async (req, res) => {
    try {
      const item = req.body;
      if (!item.id) item.id = crypto.randomUUID().slice(0, 8);
      if (!item.createdAt) item.createdAt = Date.now();
      if (!item.updatedAt) item.updatedAt = Date.now();
      if (!item.status) item.status = 'new';
      if (!item.tags) item.tags = [];
      if (!item.fields) item.fields = {};
      await memory.saveItem(item);
      res.json({ ok: true, id: item.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put('/items/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const items = await memory.getItems();
      const existing = items.find(i => i.id === id);
      if (!existing) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const updated = { ...existing, ...req.body, id: id!, updatedAt: Date.now() };
      await memory.saveItem(updated);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/items/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await memory.deleteItem(id!);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Documents - get single doc content
  router.get('/memory/documents/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const doc = await memory.getDocument(id!);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }
      return res.json(doc);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // Skills
  router.get('/skills', (_req, res) => {
    const builtin = skillRegistry.listSkills().map(s => ({
      name: s.name,
      description: s.description,
      version: s.version,
      type: 'builtin' as const,
      tools: s.tools.map(t => ({ name: t.name, description: t.description })),
    }));

    const rich = skillRegistry.listRichSkills().map(s => ({
      name: s.manifest.name,
      description: s.manifest.description,
      version: s.manifest.version,
      type: 'user-defined' as const,
      tools: s.manifest.tools.map(t => ({ name: t.name, description: t.description })),
      tags: s.manifest.tags ?? [],
      author: s.manifest.author,
      instructions: s.manifest.instructions,
      actions: Object.entries(s.manifest.actions).map(([name, action]) => ({
        name,
        steps: action.steps.map(step => step.type),
      })),
      env: s.manifest.env,
    }));

    res.json([...builtin, ...rich]);
  });

  router.get('/skills/:name', (req, res) => {
    const { name } = req.params;

    // Check built-in skills
    const builtin = skillRegistry.getSkill(name!);
    if (builtin) {
      return res.json({
        name: builtin.name,
        description: builtin.description,
        version: builtin.version,
        type: 'builtin' as const,
        tools: builtin.tools.map(t => ({ name: t.name, description: t.description })),
        systemPrompt: builtin.systemPrompt,
      });
    }

    // Check rich skills
    const rich = skillRegistry.getRichSkill(name!);
    if (rich) {
      const m = rich.manifest;
      return res.json({
        name: m.name,
        description: m.description,
        version: m.version,
        type: 'user-defined' as const,
        tools: m.tools.map(t => ({ name: t.name, description: t.description })),
        tags: m.tags ?? [],
        author: m.author,
        instructions: m.instructions,
        actions: Object.entries(m.actions).map(([actionName, action]) => ({
          name: actionName,
          steps: action.steps.map(step => step.type),
        })),
        env: m.env,
        directory: rich.skillDir,
      });
    }

    return res.status(404).json({ error: `Skill "${name}" not found` });
  });

  return router;
}
