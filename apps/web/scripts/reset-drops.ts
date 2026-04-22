import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Shifts every existing drop into a fresh demo window and resets inventory.
// UserPacks + PackCards from prior runs are left alone — they stay in the
// previous owners' /me/packs history.
//
// Tweak these to fit the demo:
const STARTS_IN_MINUTES = 2;
const ENDS_IN_HOURS = 3;

async function main() {
  const drops = await prisma.drop.findMany({
    select: { id: true, packTier: true, totalInventory: true, remaining: true },
  });
  if (drops.length === 0) {
    console.log("no drops found — run `pnpm seed` first");
    return;
  }

  const now = new Date();
  const startsAt = new Date(now.getTime() + STARTS_IN_MINUTES * 60 * 1000);
  const endsAt = new Date(now.getTime() + ENDS_IN_HOURS * 60 * 60 * 1000);

  for (const d of drops) {
    await prisma.drop.update({
      where: { id: d.id },
      data: {
        startsAt,
        endsAt,
        remaining: d.totalInventory,
        status: "SCHEDULED",
      },
    });
    console.log(
      `reset ${d.packTier} drop ${d.id.slice(0, 8)}… → remaining=${d.totalInventory}, startsAt=${startsAt.toISOString()}, endsAt=${endsAt.toISOString()}`,
    );
  }
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
