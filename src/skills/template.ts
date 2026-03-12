/**
 * Template interpolation engine for rich skills.
 * Supports {{variable}}, {{env.VAR}}, {{#if var}}...{{/if}}, {{#if var}}...{{else}}...{{/if}}
 */

export interface TemplateContext {
  args: Record<string, unknown>;
  previousStepOutput: string;
  env: Record<string, string | undefined>;
  skillDir: string;
  workingDir: string;
}

/**
 * Interpolate template variables in a string.
 * Regex-based only — no eval.
 */
export function interpolate(template: string, ctx: TemplateContext): string {
  let result = template;

  // Process {{#if var}}...{{else}}...{{/if}} blocks (supports nesting by processing innermost first)
  let maxIterations = 50;
  while (maxIterations-- > 0) {
    const ifMatch = result.match(/\{\{#if\s+(\S+?)\}\}([\s\S]*?)\{\{\/if\}\}/);
    if (!ifMatch) break;

    const [fullMatch, varName, body] = ifMatch as [string, string, string];
    const value = resolveVariable(varName, ctx);
    const isTruthy = value !== '' && value !== 'false' && value !== '0' && value !== undefined && value !== null;

    // Check for {{else}} within the body
    const elseParts = body.split('{{else}}');
    const thenBlock = elseParts[0] ?? '';
    const elseBlock = elseParts[1] ?? '';

    const replacement = isTruthy ? thenBlock : elseBlock;
    result = result.replace(fullMatch, replacement);
  }

  // Replace {{variable}} references
  result = result.replace(/\{\{(\S+?)\}\}/g, (_match, varName: string) => {
    const value = resolveVariable(varName, ctx);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });

  return result;
}

function resolveVariable(varName: string, ctx: TemplateContext): unknown {
  // Built-in variables
  if (varName === 'previousStepOutput') return ctx.previousStepOutput;
  if (varName === 'skillDir') return ctx.skillDir;
  if (varName === 'workingDir') return ctx.workingDir;

  // Environment variables: {{env.VAR_NAME}}
  if (varName.startsWith('env.')) {
    const envKey = varName.slice(4);
    return ctx.env[envKey] ?? '';
  }

  // Tool call arguments — support dotted paths like {{config.key}}
  const parts = varName.split('.');
  let current: unknown = ctx.args;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }
  return current;
}
