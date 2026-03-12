import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AgentStep } from '../agent/types.js';
import type {
  SessionRecord, MemoryFact, CachedResult, SessionSummary,
  UserProfile, TrackedItem, TrackedItemFilter, UserDocument, MemoryEntry,
  SessionResult,
} from './types.js';

export class MemoryStore {
  private dir: string;
  private sessionsDir: string;
  private factsDir: string;
  private cacheDir: string;
  private itemsDir: string;
  private documentsDir: string;
  private authDir: string;
  private profileFile: string;

  constructor(dir: string) {
    this.dir = dir;
    this.sessionsDir = path.join(dir, 'sessions');
    this.factsDir = path.join(dir, 'memory');
    this.cacheDir = path.join(dir, 'cache');
    this.itemsDir = path.join(dir, 'items');
    this.documentsDir = path.join(dir, 'documents');
    this.authDir = path.join(dir, 'auth');
    this.profileFile = path.join(dir, 'profile.json');
  }

  /** Return the base data directory and sub-paths for display. */
  getPaths(): {
    baseDir: string;
    profileFile: string;
    documentsDir: string;
    itemsDir: string;
    memoryDir: string;
    sessionsDir: string;
    skillsDir: string;
  } {
    return {
      baseDir: this.dir,
      profileFile: this.profileFile,
      documentsDir: this.documentsDir,
      itemsDir: this.itemsDir,
      memoryDir: this.factsDir,
      sessionsDir: this.sessionsDir,
      skillsDir: path.join(this.dir, 'skills'),
    };
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.factsDir, { recursive: true });
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.mkdir(this.itemsDir, { recursive: true });
    await fs.mkdir(this.documentsDir, { recursive: true });
    await fs.mkdir(this.authDir, { recursive: true });
  }

  // --- Profile management ---

  async saveProfile(profile: Partial<UserProfile>): Promise<void> {
    await this.ensureDirs();
    const existing = await this.getProfile();
    const merged: UserProfile = {
      name: profile.name ?? existing?.name ?? '',
      email: profile.email ?? existing?.email ?? '',
      phone: profile.phone ?? existing?.phone,
      location: profile.location ?? existing?.location,
      summary: profile.summary ?? existing?.summary,
      attributes: { ...(existing?.attributes ?? {}), ...(profile.attributes ?? {}) },
    };
    await fs.writeFile(this.profileFile, JSON.stringify(merged, null, 2), 'utf-8');
  }

  async getProfile(): Promise<UserProfile | null> {
    try {
      const data = await fs.readFile(this.profileFile, 'utf-8');
      return JSON.parse(data) as UserProfile;
    } catch {
      return null;
    }
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    await this.saveProfile(updates);
  }

  // --- Tracked items ---

  async saveItem(item: TrackedItem): Promise<void> {
    await this.ensureDirs();
    const filePath = path.join(this.itemsDir, `${item.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
  }

  async getItems(filter?: TrackedItemFilter): Promise<TrackedItem[]> {
    await this.ensureDirs();
    const items: TrackedItem[] = [];
    try {
      const files = await fs.readdir(this.itemsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.itemsDir, file), 'utf-8');
          const item = JSON.parse(data) as TrackedItem;
          if (filter) {
            if (filter.collection && item.collection !== filter.collection) continue;
            if (filter.status && item.status !== filter.status) continue;
            if (filter.tags && !filter.tags.every(t => item.tags.includes(t))) continue;
            if (filter.minScore !== undefined && (item.matchScore ?? 0) < filter.minScore) continue;
            if (filter.query) {
              const q = filter.query.toLowerCase();
              const searchable = `${item.title} ${item.notes ?? ''} ${JSON.stringify(item.fields)}`.toLowerCase();
              if (!searchable.includes(q)) continue;
            }
          }
          items.push(item);
        } catch {
          continue;
        }
      }
    } catch {
      // no items dir
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteItem(id: string): Promise<void> {
    try {
      const filePath = path.join(this.itemsDir, `${id}.json`);
      await fs.unlink(filePath);
    } catch {
      // Item doesn't exist
    }
  }

  async getCollections(): Promise<string[]> {
    const items = await this.getItems();
    const collections = new Set(items.map(i => i.collection));
    return Array.from(collections).sort();
  }

  // --- Documents ---

  async saveDocument(doc: UserDocument): Promise<void> {
    await this.ensureDirs();
    const filePath = path.join(this.documentsDir, `${doc.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(doc, null, 2), 'utf-8');
  }

  async getDocuments(type?: string): Promise<UserDocument[]> {
    await this.ensureDirs();
    const docs: UserDocument[] = [];
    try {
      const files = await fs.readdir(this.documentsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.documentsDir, file), 'utf-8');
          const doc = JSON.parse(data) as UserDocument;
          if (type && doc.type !== type) continue;
          docs.push(doc);
        } catch {
          continue;
        }
      }
    } catch {
      // no documents dir
    }
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getDocument(id: string): Promise<UserDocument | null> {
    try {
      const filePath = path.join(this.documentsDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as UserDocument;
    } catch {
      return null;
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      const filePath = path.join(this.documentsDir, `${id}.json`);
      await fs.unlink(filePath);
    } catch {
      // Document doesn't exist
    }
  }

  // --- Session methods ---

  async saveSession(id: string, history: AgentStep[], task?: string): Promise<void> {
    await this.ensureDirs();
    const record: SessionRecord = {
      id,
      timestamp: Date.now(),
      task: task ?? '',
      steps: history,
    };
    const filePath = path.join(this.sessionsDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
  }

  async loadSession(id: string): Promise<AgentStep[] | null> {
    try {
      const filePath = path.join(this.sessionsDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      const record = JSON.parse(data) as SessionRecord;
      return record.steps;
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureDirs();
    const summaries: SessionSummary[] = [];
    try {
      const files = await fs.readdir(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.sessionsDir, file), 'utf-8');
          const record = JSON.parse(data) as SessionRecord;
          summaries.push({
            id: record.id,
            timestamp: record.timestamp,
            task: record.task,
          });
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  }

  // --- Session results ---

  async saveSessionResult(result: SessionResult): Promise<void> {
    await this.ensureDirs();
    const sessionDir = path.join(this.sessionsDir, result.sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, 'result.json');
    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
  }

  async getSessionResults(limit?: number): Promise<SessionResult[]> {
    await this.ensureDirs();
    const results: SessionResult[] = [];
    try {
      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const resultPath = path.join(this.sessionsDir, entry.name, 'result.json');
          const data = await fs.readFile(resultPath, 'utf-8');
          results.push(JSON.parse(data) as SessionResult);
        } catch {
          // No result.json in this session directory
        }
      }
    } catch {
      // Sessions directory doesn't exist
    }
    results.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    return limit ? results.slice(0, limit) : results;
  }

  async getSessionResult(sessionId: string): Promise<SessionResult | null> {
    try {
      const resultPath = path.join(this.sessionsDir, sessionId, 'result.json');
      const data = await fs.readFile(resultPath, 'utf-8');
      return JSON.parse(data) as SessionResult;
    } catch {
      return null;
    }
  }

  // --- Long-term memory ---

  async remember(key: string, value: unknown, category?: string): Promise<void> {
    await this.ensureDirs();
    const cat = category ?? 'general';
    const catFile = path.join(this.factsDir, `${cat}.json`);

    let facts: Record<string, MemoryFact> = {};
    try {
      const data = await fs.readFile(catFile, 'utf-8');
      facts = JSON.parse(data) as Record<string, MemoryFact>;
    } catch {
      // New category
    }

    facts[key] = { key, value, timestamp: Date.now(), category: cat };
    await fs.writeFile(catFile, JSON.stringify(facts, null, 2), 'utf-8');
  }

  async recall(key: string): Promise<unknown> {
    await this.ensureDirs();
    try {
      const files = await fs.readdir(this.factsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.factsDir, file), 'utf-8');
          const facts = JSON.parse(data) as Record<string, MemoryFact>;
          if (facts[key]) return facts[key].value;
        } catch {
          continue;
        }
      }
    } catch {
      // no facts dir
    }
    return null;
  }

  async search(query: string): Promise<MemoryEntry[]> {
    await this.ensureDirs();
    const lowerQuery = query.toLowerCase();
    const results: MemoryEntry[] = [];

    try {
      const files = await fs.readdir(this.factsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.factsDir, file), 'utf-8');
          const facts = JSON.parse(data) as Record<string, MemoryFact>;
          for (const [k, fact] of Object.entries(facts)) {
            if (
              k.toLowerCase().includes(lowerQuery) ||
              JSON.stringify(fact.value).toLowerCase().includes(lowerQuery)
            ) {
              results.push({
                key: k,
                value: fact.value,
                category: fact.category,
                timestamp: fact.timestamp,
              });
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // no facts dir
    }

    return results;
  }

  async getByCategory(category: string): Promise<MemoryEntry[]> {
    await this.ensureDirs();
    const catFile = path.join(this.factsDir, `${category}.json`);
    try {
      const data = await fs.readFile(catFile, 'utf-8');
      const facts = JSON.parse(data) as Record<string, MemoryFact>;
      return Object.values(facts).map(f => ({
        key: f.key,
        value: f.value,
        category: f.category,
        timestamp: f.timestamp,
      }));
    } catch {
      return [];
    }
  }

  // --- Site auth tracking ---

  async markSiteAuthenticated(domain: string): Promise<void> {
    await this.ensureDirs();
    const filePath = path.join(this.authDir, `${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
    await fs.writeFile(filePath, JSON.stringify({ domain, timestamp: Date.now() }), 'utf-8');
  }

  async isSiteAuthenticated(domain: string): Promise<boolean> {
    try {
      const filePath = path.join(this.authDir, `${domain.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // --- Cache ---

  async cacheResult(taskHash: string, result: string): Promise<void> {
    await this.ensureDirs();
    const cached: CachedResult = {
      taskHash,
      result,
      timestamp: Date.now(),
    };
    const filePath = path.join(this.cacheDir, `${taskHash}.json`);
    await fs.writeFile(filePath, JSON.stringify(cached, null, 2), 'utf-8');
  }

  async getCachedResult(taskHash: string): Promise<string | null> {
    try {
      const filePath = path.join(this.cacheDir, `${taskHash}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached = JSON.parse(data) as CachedResult;
      return cached.result;
    } catch {
      return null;
    }
  }

  /**
   * Search across profile, documents, items, and memory facts by keyword.
   * Returns relevant snippets from each source without loading everything.
   */
  async searchAll(query: string): Promise<{
    profile: string[];
    documents: { name: string; type: string; snippets: string[] }[];
    items: { title: string; collection: string; status: string; url: string }[];
    facts: { key: string; value: unknown }[];
  }> {
    const lowerQuery = query.toLowerCase();
    const result = {
      profile: [] as string[],
      documents: [] as { name: string; type: string; snippets: string[] }[],
      items: [] as { title: string; collection: string; status: string; url: string }[],
      facts: [] as { key: string; value: unknown }[],
    };

    // Search profile
    try {
      const profile = await this.getProfile();
      if (profile) {
        const profileStr = JSON.stringify(profile).toLowerCase();
        if (profileStr.includes(lowerQuery)) {
          if (profile.name?.toLowerCase().includes(lowerQuery)) result.profile.push(`Name: ${profile.name}`);
          if (profile.email?.toLowerCase().includes(lowerQuery)) result.profile.push(`Email: ${profile.email}`);
          if (profile.location?.toLowerCase().includes(lowerQuery)) result.profile.push(`Location: ${profile.location}`);
          if (profile.summary?.toLowerCase().includes(lowerQuery)) result.profile.push(`Summary: ${profile.summary}`);
          for (const [key, value] of Object.entries(profile.attributes ?? {})) {
            if (`${key} ${JSON.stringify(value)}`.toLowerCase().includes(lowerQuery)) {
              result.profile.push(`${key}: ${JSON.stringify(value)}`);
            }
          }
        }
      }
    } catch { /* no profile */ }

    // Search documents — return matching snippets (lines containing the query)
    try {
      const documents = await this.getDocuments();
      for (const doc of documents) {
        const searchable = `${doc.name} ${doc.type} ${doc.content}`.toLowerCase();
        if (!searchable.includes(lowerQuery)) continue;
        const lines = doc.content.split('\n');
        const matchingLines: string[] = [];
        for (const line of lines) {
          if (line.toLowerCase().includes(lowerQuery)) {
            matchingLines.push(line.trim().slice(0, 200));
            if (matchingLines.length >= 5) break;
          }
        }
        result.documents.push({ name: doc.name, type: doc.type, snippets: matchingLines });
      }
    } catch { /* no documents */ }

    // Search tracked items
    try {
      const items = await this.getItems({ query });
      for (const item of items.slice(0, 10)) {
        result.items.push({ title: item.title, collection: item.collection, status: item.status, url: item.url });
      }
    } catch { /* no items */ }

    // Search memory facts
    try {
      const facts = await this.search(query);
      for (const fact of facts.slice(0, 10)) {
        result.facts.push({ key: fact.key, value: fact.value });
      }
    } catch { /* no facts */ }

    return result;
  }

  static hashTask(task: string): string {
    return crypto.createHash('sha256').update(task).digest('hex').slice(0, 16);
  }
}
