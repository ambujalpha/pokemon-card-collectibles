// Fairness jitter for the purchase admission path.
// See docs/qa/phase-9-anti-bot.md §2.

export const FAIRNESS_JITTER_MS = 500;

export function jitter(maxMs: number = FAIRNESS_JITTER_MS): Promise<void> {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
