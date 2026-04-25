import { PackTier } from "@prisma/client";

import { prisma } from "@/lib/db";

// Admin alert evaluator. Three pure evaluators (`evalMarginDrift`,
// `evalChiSquared`, `evalBotSpike`) return null/yellow/red against
// `ALERT_THRESHOLDS`. `persistAlert` deduplicates on unacknowledged
// (kind, tier) so re-evaluation doesn't spam.

export type AlertKind =
  | "margin_drift"
  | "chi_squared_drift"
  | "bot_flag_rate_spike";

export type Severity = "yellow" | "red";

export interface AlertThresholds {
  marginDrift: { yellowPp: number; redPp: number };
  chiSquaredDrift: { yellowP: number; redP: number };
  botFlagRateSpike: { yellowFactor: number; redFactor: number };
}

export const ALERT_THRESHOLDS: AlertThresholds = {
  marginDrift: { yellowPp: 0.03, redPp: 0.06 },
  chiSquaredDrift: { yellowP: 0.05, redP: 0.01 },
  botFlagRateSpike: { yellowFactor: 1.5, redFactor: 2.0 },
};

export interface AlertEval {
  kind: AlertKind;
  severity: Severity;
  message: string;
  detail: Record<string, unknown>;
}

export function evalMarginDrift(
  tier: PackTier,
  realisedMargin: number,
  targetMargin: number,
): AlertEval | null {
  const drift = Math.abs(realisedMargin - targetMargin);
  if (drift > ALERT_THRESHOLDS.marginDrift.redPp) {
    return {
      kind: "margin_drift",
      severity: "red",
      message: `${tier}: realised margin ${(realisedMargin * 100).toFixed(2)}% deviates from target ${(targetMargin * 100).toFixed(0)}% by ${(drift * 100).toFixed(2)}pp (red)`,
      detail: { tier, realisedMargin, targetMargin, drift },
    };
  }
  if (drift > ALERT_THRESHOLDS.marginDrift.yellowPp) {
    return {
      kind: "margin_drift",
      severity: "yellow",
      message: `${tier}: realised margin drifts ${(drift * 100).toFixed(2)}pp from target (yellow)`,
      detail: { tier, realisedMargin, targetMargin, drift },
    };
  }
  return null;
}

export function evalChiSquared(tier: PackTier, pValue: number, df: number): AlertEval | null {
  if (pValue < ALERT_THRESHOLDS.chiSquaredDrift.redP) {
    return {
      kind: "chi_squared_drift",
      severity: "red",
      message: `${tier}: rarity distribution drifts from advertised (p=${pValue.toExponential(2)}, df=${df}, red)`,
      detail: { tier, pValue, df },
    };
  }
  if (pValue < ALERT_THRESHOLDS.chiSquaredDrift.yellowP) {
    return {
      kind: "chi_squared_drift",
      severity: "yellow",
      message: `${tier}: rarity distribution differs from advertised (p=${pValue.toFixed(3)}, df=${df}, yellow)`,
      detail: { tier, pValue, df },
    };
  }
  return null;
}

export function evalBotSpike(currentRate: number, baselineRate: number): AlertEval | null {
  if (baselineRate <= 0) return null;
  const factor = currentRate / baselineRate;
  if (factor > ALERT_THRESHOLDS.botFlagRateSpike.redFactor) {
    return {
      kind: "bot_flag_rate_spike",
      severity: "red",
      message: `Bot flag rate ${factor.toFixed(2)}× 7d average (red)`,
      detail: { currentRate, baselineRate, factor },
    };
  }
  if (factor > ALERT_THRESHOLDS.botFlagRateSpike.yellowFactor) {
    return {
      kind: "bot_flag_rate_spike",
      severity: "yellow",
      message: `Bot flag rate ${factor.toFixed(2)}× 7d average (yellow)`,
      detail: { currentRate, baselineRate, factor },
    };
  }
  return null;
}

// Persist a fresh evaluation. Skips writing if an unacknowledged alert of
// the same kind+detail.tier already exists — avoids alert spam.
export async function persistAlert(a: AlertEval): Promise<void> {
  const tier = (a.detail as { tier?: string }).tier ?? null;
  const exists = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM admin_alerts
    WHERE kind = ${a.kind}
      AND acknowledged_at IS NULL
      AND (${tier}::text IS NULL OR detail_json->>'tier' = ${tier}::text)
    LIMIT 1
  `;
  if (exists.length > 0) return;

  await prisma.$executeRaw`
    INSERT INTO admin_alerts (id, kind, severity, message, detail_json)
    VALUES (
      gen_random_uuid(),
      ${a.kind},
      ${a.severity},
      ${a.message},
      ${JSON.stringify(a.detail)}::jsonb
    )
  `;
}
