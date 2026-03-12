import type { AgentStep } from '../agent/types.js';

export interface SessionRecord {
  id: string;
  timestamp: number;
  task: string;
  steps: AgentStep[];
}

export interface MemoryFact {
  key: string;
  value: unknown;
  timestamp: number;
  category?: string;
}

export interface CachedResult {
  taskHash: string;
  result: string;
  timestamp: number;
}

export interface SessionSummary {
  id: string;
  timestamp: number;
  task: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  summary?: string;
  /** Flexible key-value preferences and attributes */
  attributes: Record<string, unknown>;
}

export interface TrackedItem {
  id: string;
  /** User-defined or auto-detected category: "job", "apartment", "contract", "product", etc. */
  collection: string;
  /** Primary label */
  title: string;
  /** Source URL where this was found */
  url: string;
  /** When this item was first tracked */
  createdAt: number;
  /** When this item was last updated */
  updatedAt: number;
  /** User-controlled status lifecycle */
  status: 'new' | 'saved' | 'applied' | 'rejected' | 'archived';
  /** Match score (0-100) when compared against a document */
  matchScore?: number;
  /** Free-form user notes */
  notes?: string;
  /** Flexible key-value fields extracted from the page */
  fields: Record<string, unknown>;
  /** Tags for cross-collection organization */
  tags: string[];
}

export interface TrackedItemFilter {
  collection?: string;
  status?: TrackedItem['status'];
  tags?: string[];
  minScore?: number;
  /** Search across title, notes, and field values */
  query?: string;
}

export interface TrackedItemMatch {
  item: TrackedItem;
  score: number;
  matchedCriteria: string[];
  missingCriteria: string[];
  reasoning: string;
}

export interface UserDocument {
  id: string;
  /** Human-readable name */
  name: string;
  /** Category hint: "resume", "requirements", "portfolio", "wishlist", or any user string */
  type: string;
  /** Raw text content */
  content: string;
  /** When imported/updated */
  updatedAt: number;
  /** Optional structured data extracted by LLM */
  parsed?: Record<string, unknown>;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  category?: string;
  timestamp: number;
}
