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
  skills: string[];
  experience: WorkExperience[];
  education: Education[];
  preferences: Record<string, string>;
  customFields: Record<string, unknown>;
}

export interface WorkExperience {
  title: string;
  company: string;
  startDate: string;
  endDate?: string;
  description: string;
  skills: string[];
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  year: string;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  requirements: string[];
  salary?: string;
  postedDate?: string;
  matchScore?: number;
  status: 'new' | 'applied' | 'saved' | 'rejected';
  notes?: string;
}

export interface JobFilter {
  status?: JobListing['status'];
  company?: string;
  location?: string;
  minScore?: number;
}

export interface JobMatch {
  job: JobListing;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasoning: string;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  category?: string;
  timestamp: number;
}
