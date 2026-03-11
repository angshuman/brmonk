export interface AgentStep {
  observation: string;
  reasoning: string;
  actions: { name: string; args: Record<string, unknown>; result: string }[];
}

export interface AgentState {
  taskDescription: string;
  currentUrl: string;
  pageTitle: string;
  domSnapshot: string;
  history: AgentStep[];
  stepCount: number;
  maxSteps: number;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'waiting-for-user';
  result: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanStep {
  description: string;
  checkpoint: string;
}
