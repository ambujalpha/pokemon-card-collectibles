// Admission-fairness jitter for the purchase path.
//
// Adding 0–500 ms of uniform jitter before the row-lock randomises the
// admission order inside that window, so a bot fastest-by-network can no
// longer reliably win a sold-out drop. Cost: ~250 ms median latency on
// the purchase path; humans don't notice, bots lose their edge.

export const FAIRNESS_JITTER_MS = 500;

export function jitter(maxMs: number = FAIRNESS_JITTER_MS): Promise<void> {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
