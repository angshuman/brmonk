export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelay ?? 1000;
  const maxDelay = options?.maxDelay ?? 10000;
  const backoffFactor = options?.backoffFactor ?? 2;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }

  throw lastError ?? new Error('Retry failed');
}
