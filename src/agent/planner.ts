import type { LLMProvider } from '../llm/types.js';
import type { TaskPlan, PlanStep } from './types.js';
import { logger } from '../utils/logger.js';

export class TaskPlanner {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async createPlan(task: string): Promise<TaskPlan> {
    logger.plan(`Planning task: ${task}`);

    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a task planner for a browser automation agent. Given a task description, break it down into clear sequential steps.
Respond with a JSON object containing:
- "goal": a one-sentence summary of the task goal
- "steps": an array of objects, each with "description" (what to do) and "checkpoint" (how to verify it's done)

Return ONLY valid JSON, no markdown code blocks or other text.`,
      },
      {
        role: 'user',
        content: `Plan the following browser automation task: ${task}`,
      },
    ], { temperature: 0.3, maxTokens: 1024 });

    const content = response.content ?? '{}';
    let parsed: { goal?: string; steps?: PlanStep[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      // If JSON parsing fails, create a simple single-step plan
      parsed = {
        goal: task,
        steps: [{ description: task, checkpoint: 'Task completed' }],
      };
    }

    const plan: TaskPlan = {
      goal: parsed.goal ?? task,
      steps: Array.isArray(parsed.steps) ? parsed.steps.map(s => ({
        description: String(s.description ?? ''),
        checkpoint: String(s.checkpoint ?? ''),
      })) : [{ description: task, checkpoint: 'Task completed' }],
    };

    logger.plan(`Plan created with ${plan.steps.length} steps`);
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (step) {
        logger.plan(`  ${i + 1}. ${step.description}`);
      }
    }

    return plan;
  }
}
