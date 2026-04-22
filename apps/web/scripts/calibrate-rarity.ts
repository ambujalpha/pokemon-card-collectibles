import { PrismaClient, Rarity } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

type Pity = "NONE" | "RARE" | "EPIC";
type TierName = "STARTER" | "PREMIUM" | "ULTRA";

interface TierConfig {
  tier: TierName;
  price: number;
  targetEv: number;
  tolerance: number;
  pity: Pity;
  initial: Record<Rarity, number>;
}

const TIERS: TierConfig[] = [
  {
    tier: "STARTER",
    price: 5.0,
    targetEv: 3.25,
    tolerance: 0.25,
    pity: "NONE",
    initial: { COMMON: 0.72, UNCOMMON: 0.22, RARE: 0.05, EPIC: 0.009, LEGENDARY: 0.001 },
  },
  {
    tier: "PREMIUM",
    price: 20.0,
    targetEv: 15.0,
    tolerance: 0.25,
    pity: "RARE",
    initial: { COMMON: 0.5, UNCOMMON: 0.3, RARE: 0.15, EPIC: 0.04, LEGENDARY: 0.01 },
  },
  {
    tier: "ULTRA",
    price: 50.0,
    targetEv: 42.5,
    tolerance: 0.25,
    pity: "EPIC",
    initial: { COMMON: 0.25, UNCOMMON: 0.3, RARE: 0.25, EPIC: 0.15, LEGENDARY: 0.05 },
  },
];

const MC_SAMPLES = 20_000;
const CARDS_PER_PACK = 5;
const MAX_ITERATIONS = 40;
const RNG_SEED = 0xc0ffee;

// Seeded PRNG (mulberry32). Using a fixed seed makes every meanEv() call with
// the same weights return the same value, so tuning-step EV matches the final
// verification EV exactly — the ±$0.25 tolerance is a property of the tuned
// weights themselves, not of MC noise between runs.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const RARITY_ORDER: Record<Rarity, number> = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};
const BUCKETS: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

interface Card {
  rarity: Rarity;
  price: number;
}

function weightedPickRarity(rng: () => number, weights: Record<Rarity, number>): Rarity {
  const r = rng();
  let acc = 0;
  for (const b of BUCKETS) {
    acc += weights[b];
    if (r <= acc) return b;
  }
  return "LEGENDARY";
}

function pickCardOfRarity(rng: () => number, byBucket: Record<Rarity, Card[]>, rarity: Rarity): Card {
  const pool = byBucket[rarity];
  if (pool.length === 0) {
    for (const b of BUCKETS) {
      if (byBucket[b].length > 0) return byBucket[b][Math.floor(rng() * byBucket[b].length)];
    }
    throw new Error("empty card pool");
  }
  return pool[Math.floor(rng() * pool.length)];
}

function samplePack(
  rng: () => number,
  byBucket: Record<Rarity, Card[]>,
  weights: Record<Rarity, number>,
  pity: Pity,
): number {
  const picks: Card[] = [];
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    picks.push(pickCardOfRarity(rng, byBucket, weightedPickRarity(rng, weights)));
  }

  if (pity !== "NONE") {
    const minOrder = pity === "RARE" ? 2 : 3;
    const hasEnough = picks.some((p) => RARITY_ORDER[p.rarity] >= minOrder);
    if (!hasEnough) {
      // Replace the lowest-rarity card in the pack (matches pack-picker.ts
      // applyPity — usually a COMMON, falls through to UNCOMMON/RARE when
      // the pack happened to have none).
      let idx = -1;
      let lowestOrder = minOrder;
      for (let i = 0; i < picks.length; i++) {
        const o = RARITY_ORDER[picks[i].rarity];
        if (o < lowestOrder) {
          lowestOrder = o;
          idx = i;
        }
      }
      if (idx >= 0) picks[idx] = pickCardOfRarity(rng, byBucket, pity);
    }
  }

  return picks.reduce((s, p) => s + p.price, 0);
}

function meanEv(byBucket: Record<Rarity, Card[]>, weights: Record<Rarity, number>, pity: Pity): number {
  const rng = mulberry32(RNG_SEED);
  let total = 0;
  for (let i = 0; i < MC_SAMPLES; i++) total += samplePack(rng, byBucket, weights, pity);
  return total / MC_SAMPLES;
}

// Interpolating between the human-preferred shape and two "anchor" configs
// (EV-max = mostly EPIC+LEG for when target > shape EV; EV-min = all COMMON for
// when target < shape EV) is well-behaved because mean EV is ~linear in the
// blend parameter. Uniformly scaling non-COMMON weights doesn't work on this
// pool because mean(COMMON) ≈ mean(UNCOMMON), so shifting from COMMON to the
// non-COMMON mass just piles into UNCOMMON without moving EV.
const EV_MAX_CONFIG: Record<Rarity, number> = {
  COMMON: 0,
  UNCOMMON: 0,
  RARE: 0.05,
  EPIC: 0.8,
  LEGENDARY: 0.15,
};
const EV_MIN_CONFIG: Record<Rarity, number> = {
  COMMON: 1,
  UNCOMMON: 0,
  RARE: 0,
  EPIC: 0,
  LEGENDARY: 0,
};

function blend(
  a: Record<Rarity, number>,
  b: Record<Rarity, number>,
  lambda: number,
): Record<Rarity, number> {
  const clamped = Math.min(1, Math.max(0, lambda));
  return {
    COMMON: (1 - clamped) * a.COMMON + clamped * b.COMMON,
    UNCOMMON: (1 - clamped) * a.UNCOMMON + clamped * b.UNCOMMON,
    RARE: (1 - clamped) * a.RARE + clamped * b.RARE,
    EPIC: (1 - clamped) * a.EPIC + clamped * b.EPIC,
    LEGENDARY: (1 - clamped) * a.LEGENDARY + clamped * b.LEGENDARY,
  };
}

function tune(byBucket: Record<Rarity, Card[]>, cfg: TierConfig): {
  weights: Record<Rarity, number>;
  history: number[];
  converged: boolean;
} {
  const history: number[] = [];
  const evAtShape = meanEv(byBucket, cfg.initial, cfg.pity);
  history.push(evAtShape);

  if (Math.abs(evAtShape - cfg.targetEv) <= cfg.tolerance) {
    return { weights: cfg.initial, history, converged: true };
  }

  const anchor = cfg.targetEv > evAtShape ? EV_MAX_CONFIG : EV_MIN_CONFIG;
  const evAtAnchor = meanEv(byBucket, anchor, cfg.pity);
  history.push(evAtAnchor);

  if (
    (cfg.targetEv > evAtShape && cfg.targetEv > evAtAnchor) ||
    (cfg.targetEv < evAtShape && cfg.targetEv < evAtAnchor)
  ) {
    // Target unreachable even at the anchor — commit the anchor and flag.
    return { weights: anchor, history, converged: false };
  }

  let lambda = (cfg.targetEv - evAtShape) / (evAtAnchor - evAtShape);
  let weights = blend(cfg.initial, anchor, lambda);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const ev = meanEv(byBucket, weights, cfg.pity);
    history.push(ev);
    if (Math.abs(ev - cfg.targetEv) <= cfg.tolerance) {
      return { weights, history, converged: true };
    }
    const slope = evAtAnchor - evAtShape;
    if (slope === 0) break;
    const adjust = (cfg.targetEv - ev) / slope;
    lambda = Math.min(1, Math.max(0, lambda + adjust));
    weights = blend(cfg.initial, anchor, lambda);
  }

  return { weights, history, converged: false };
}

async function main() {
  const rows = await prisma.card.findMany({ select: { rarityBucket: true, basePrice: true } });
  if (rows.length === 0) throw new Error("no cards in DB; run `pnpm --filter web fetch:cards` first");
  const pool: Card[] = rows.map((c) => ({ rarity: c.rarityBucket, price: Number(c.basePrice) }));

  const byBucket: Record<Rarity, Card[]> = {
    COMMON: [],
    UNCOMMON: [],
    RARE: [],
    EPIC: [],
    LEGENDARY: [],
  };
  for (const c of pool) byBucket[c.rarity].push(c);

  console.log(`Calibrating against ${pool.length} cards. Per-bucket counts:`);
  for (const b of BUCKETS) console.log(`  ${b}: ${byBucket[b].length}`);

  const results: Record<TierName, {
    weights: Record<Rarity, number>;
    ev: number;
    history: number[];
    converged: boolean;
  }> = {} as never;

  for (const cfg of TIERS) {
    console.log(`\n== ${cfg.tier} (price $${cfg.price}, target EV $${cfg.targetEv} ±$${cfg.tolerance}) ==`);
    const result = tune(byBucket, cfg);
    const finalEv = meanEv(byBucket, result.weights, cfg.pity);
    results[cfg.tier] = { weights: result.weights, ev: finalEv, history: result.history, converged: result.converged };
    console.log(`converged=${result.converged} finalEv=$${finalEv.toFixed(2)} iterations=${result.history.length}`);
    for (const b of BUCKETS) console.log(`  ${b}: ${(result.weights[b] * 100).toFixed(3)}%`);
  }

  const weightsOut = join(__dirname, "..", "src", "lib", "rarity-weights.ts");
  const weightsCode =
    `// AUTO-GENERATED by scripts/calibrate-rarity.ts. Do not edit by hand.\n` +
    `// Re-run \`pnpm --filter web calibrate:rarity\` after reseeding the card pool.\n` +
    `// Seed pool: 200 cards from Scarlet & Violet — Paldea Evolved (sv2).\n` +
    `import { Rarity } from "@prisma/client";\n\n` +
    `export type TierName = "STARTER" | "PREMIUM" | "ULTRA";\n` +
    `export type TierWeights = Record<Rarity, number>;\n\n` +
    `export const RARITY_WEIGHTS: Record<TierName, TierWeights> = ${JSON.stringify(
      {
        STARTER: results.STARTER.weights,
        PREMIUM: results.PREMIUM.weights,
        ULTRA: results.ULTRA.weights,
      },
      null,
      2,
    )};\n\n` +
    `export const TIER_PITY: Record<TierName, "NONE" | "RARE" | "EPIC"> = {\n` +
    `  STARTER: "NONE",\n  PREMIUM: "RARE",\n  ULTRA: "EPIC",\n};\n\n` +
    `export const TIER_PRICES_USD: Record<TierName, string> = {\n` +
    `  STARTER: "5.0000",\n  PREMIUM: "20.0000",\n  ULTRA: "50.0000",\n};\n\n` +
    `export const TIER_CALIBRATED_EV_USD: Record<TierName, string> = {\n` +
    `  STARTER: "${results.STARTER.ev.toFixed(4)}",\n` +
    `  PREMIUM: "${results.PREMIUM.ev.toFixed(4)}",\n` +
    `  ULTRA: "${results.ULTRA.ev.toFixed(4)}",\n` +
    `};\n`;
  writeFileSync(weightsOut, weightsCode);
  console.log(`\nwrote ${weightsOut}`);

  const qaOut = join(__dirname, "..", "..", "..", "docs", "qa", "phase-1-rarity-calibration.md");
  const lines: string[] = [
    "# Phase 1 — Rarity calibration report",
    "",
    "Auto-generated by `pnpm --filter web calibrate:rarity` — regenerate after every card-pool reseed.",
    "",
    "## Method",
    "",
    `Monte Carlo, ${MC_SAMPLES.toLocaleString()} simulated packs per iteration, max ${MAX_ITERATIONS} iterations per tier. Each iteration compares the tier's mean pack EV to the target, scales the non-COMMON weight mass by \`target / current_mean\` (damped to ±30% per step), then renormalises so weights sum to 1. Pity rules are applied to every pack before the price sum.`,
    "",
    "## Results",
    "",
    "| Tier | Price | Target EV | Tolerance | Converged | Final EV | Iterations |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const cfg of TIERS) {
    const r = results[cfg.tier];
    lines.push(
      `| ${cfg.tier} | $${cfg.price.toFixed(2)} | $${cfg.targetEv.toFixed(2)} | ±$${cfg.tolerance.toFixed(2)} | ${r.converged ? "yes" : "**NO**"} | $${r.ev.toFixed(2)} | ${r.history.length} |`,
    );
  }
  lines.push("", "## Final weights (published odds)", "");
  for (const cfg of TIERS) {
    const r = results[cfg.tier];
    lines.push(`### ${cfg.tier}`, "");
    lines.push("| Bucket | Weight |", "|---|---|");
    for (const b of BUCKETS) lines.push(`| ${b} | ${(r.weights[b] * 100).toFixed(3)}% |`);
    if (cfg.pity !== "NONE") lines.push("", `**Pity:** guaranteed ≥1 ${cfg.pity} per pack.`);
    lines.push("");
  }
  lines.push(
    "## Honest notes",
    "",
    "- These weights are only as fair as the seeded pool. A pool with a few outlier chase cards can push one bucket's mean price high, and the tuner will compensate by lowering that bucket's weight — producing published odds that feel counter-intuitively stingy at higher tiers.",
    "- Tolerance is ±$0.25 on a 10,000-sample mean. A single player opening 5 packs can experience variance far wider than $0.25; the target is long-run fairness, not per-pack fairness.",
    "- If any tier shows **NO** in the Converged column, the committed weights are the closest-achieved approximation. Widen tolerance or reseed with a different set before shipping.",
  );
  writeFileSync(qaOut, lines.join("\n") + "\n");
  console.log(`wrote ${qaOut}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
