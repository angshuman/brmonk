export interface SessionSummary {
  id: string;
  task: string;
  status: string;
  startedAt: number;
  eventCount: number;
}

export interface StoredSession {
  sessionId: string;
  task: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  stepCount?: number;
  steps?: number;
  toolsUsed?: string[];
  urls?: string[];
  summary?: string;
}

export type AgentEvent =
  | { type: 'step'; sessionId: string; step: number; maxSteps: number }
  | { type: 'action'; sessionId: string; action: string; args: Record<string, unknown> }
  | { type: 'action-result'; sessionId: string; action: string; result: string }
  | { type: 'thought'; sessionId: string; message: string }
  | { type: 'plan'; sessionId: string; steps: string[] }
  | { type: 'plan-progress'; sessionId: string; stepIndex: number; status: string }
  | { type: 'status'; sessionId: string; status: string }
  | { type: 'result'; sessionId: string; result: string }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'user-action-required'; sessionId: string; prompt: string; actionType: 'login' | 'captcha' | 'confirmation' }
  | { type: 'user-action-resolved'; sessionId: string }
  | { type: 'popup-dismissed'; sessionId: string; description: string }
  | { type: 'page-navigated'; sessionId: string; url: string }
  | { type: 'session-result'; sessionId: string; sessionResult: unknown }
  | { type: 'browser-screenshot'; sessionId: string; data: string; url: string; timestamp: number };

export interface BrowserScreenshot {
  data: string;
  url: string;
  timestamp: number;
}

export type ServerMessage =
  | { type: 'session-created'; sessionId: string; task: string }
  | { type: 'event-replay'; sessionId: string; events: AgentEvent[] }
  | AgentEvent;

export interface UserProfile {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  attributes?: Record<string, unknown>;
}

export interface UserDocument {
  id: string;
  name: string;
  type: string;
  content: string;
  updatedAt: number;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  category?: string;
  timestamp?: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  version: string;
  type: 'builtin' | 'user-defined';
  tools: { name: string; description: string }[];
  tags?: string[];
  author?: string;
  instructions?: string;
  actions?: { name: string; steps: string[] }[];
  env?: { required?: string[]; optional?: string[] };
  systemPrompt?: string;
  directory?: string;
}

export interface TrackedItem {
  id: string;
  collection: string;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  status: 'new' | 'saved' | 'applied' | 'rejected' | 'archived';
  matchScore?: number;
  notes?: string;
  fields: Record<string, unknown>;
  tags: string[];
}

export interface CollectionInfo {
  name: string;
  count: number;
}
