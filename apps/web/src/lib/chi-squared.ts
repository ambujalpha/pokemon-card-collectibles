// Pure chi-squared goodness-of-fit, used by the fairness audit endpoint and
// the Phase 12 dashboard. Avoids pulling in a stats library.
//
// Returns the chi-squared statistic, degrees of freedom, and an approximate
// upper-tail p-value via the Wilson–Hilferty cube-root transform — accurate
// enough for the >0.05 / <0.01 thresholds we surface to admins.

export interface ChiSquaredResult {
  chi2: number;
  df: number;
  pValue: number;
}

export function chiSquaredGof(
  observed: readonly number[],
  expectedProbs: readonly number[],
): ChiSquaredResult {
  if (observed.length !== expectedProbs.length) {
    throw new Error("observed and expectedProbs must have the same length");
  }
  const n = observed.reduce((a, b) => a + b, 0);
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expectedProbs[i]! * n;
    if (e <= 0) continue;
    const diff = observed[i]! - e;
    chi2 += (diff * diff) / e;
  }
  const df = observed.length - 1;
  const pValue = upperTailChi2P(chi2, df);
  return { chi2, df, pValue };
}

// Wilson–Hilferty: ((X²/k)^(1/3) - (1 - 2/(9k))) / sqrt(2/(9k)) ~ N(0,1).
// Convert that z to the upper-tail probability via a standard-normal SF.
function upperTailChi2P(chi2: number, df: number): number {
  if (df <= 0) return 1;
  if (chi2 <= 0) return 1;
  const k = df;
  const z = (Math.cbrt(chi2 / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return normalSurvival(z);
}

// 1 - Φ(z), via a high-accuracy Abramowitz & Stegun approximation.
function normalSurvival(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const az = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * az);
  const d = 0.3989422804014327 * Math.exp(-(az * az) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return sign === 1 ? p : 1 - p;
}
