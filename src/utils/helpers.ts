/**
 * Generate a random integer delay between min and max (inclusive).
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
