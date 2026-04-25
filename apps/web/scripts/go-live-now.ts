import { PrismaClient } from "@prisma/client";

// One-shot: set every drop LIVE right now and refill inventory.
//
// Usage:
//   pnpm --filter web tsx scripts/go-live-now.ts          # default 2-minute window
//   pnpm --filter web tsx scripts/go-live-now.ts 5m       # 5-minute window
//   pnpm --filter web tsx scripts/go-live-now.ts 3h       # 3-hour window
//   pnpm --filter web tsx scripts/go-live-now.ts 30       # 30 minutes (bare number)

const DEFAULT_DURATION_MIN = 2;

function parseDurationMinutes(raw: string | undefined): number {
  if (!raw) return DEFAULT_DURATION_MIN;
  const m = /^(\d+)\s*([mh]?)$/i.exec(raw.trim());
  if (!m) {
    console.warn(`couldn't parse "${raw}", falling back to ${DEFAULT_DURATION_MIN} minutes`);
    return DEFAULT_DURATION_MIN;
  }
  const n = Number(m[1]);
  const unit = (m[2] || "m").toLowerCase();
  return unit === "h" ? n * 60 : n;
}

const prisma = new PrismaClient();

async function main() {
  const durationMin = parseDurationMinutes(process.argv[2]);

  const drops = await prisma.drop.findMany({
    select: { id: true, packTier: true, totalInventory: true },
  });
  if (drops.length === 0) {
    console.log("no drops in the DB — run `pnpm --filter web seed` first");
    return;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationMin * 60 * 1000);
  console.log(`going LIVE for ${durationMin} minute${durationMin === 1 ? "" : "s"} → closes at ${endsAt.toISOString()}`);

  for (const d of drops) {
    await prisma.drop.update({
      where: { id: d.id },
      data: {
        startsAt: now,
        endsAt,
        remaining: d.totalInventory,
        status: "LIVE",
      },
    });
    console.log(
      `LIVE ${d.packTier} ${d.id.slice(0, 8)}… inventory=${d.totalInventory} until ${endsAt.toISOString()}`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
