import bcrypt from "bcryptjs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_USERS: Array<{ email: string; password: string; isAdmin?: boolean }> = [
  { email: "alice@pullvault.local", password: "password123" },
  { email: "bob@pullvault.local", password: "password123" },
  { email: "admin@pullvault.local", password: "password123", isAdmin: true },
];

async function main() {
  for (const demo of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demo.password, 12);
    await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: {
        email: demo.email,
        passwordHash,
        isAdmin: demo.isAdmin ?? false,
      },
    });
    console.log(`seeded ${demo.email}${demo.isAdmin ? " (admin)" : ""}`);
  }

  const admin = await prisma.user.findUnique({
    where: { email: "admin@pullvault.local" },
  });
  if (!admin) throw new Error("admin user not found after user seed");

  const now = new Date();
  const startsAt = new Date(now.getTime() + 2 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  for (const tier of ["STARTER", "PREMIUM", "ULTRA"] as const) {
    const existing = await prisma.drop.count({ where: { packTier: tier } });
    if (existing > 0) {
      console.log(`drops for ${tier} already exist (${existing}); skipping`);
      continue;
    }
    await prisma.drop.create({
      data: {
        packTier: tier,
        totalInventory: 10,
        remaining: 10,
        startsAt,
        endsAt,
        status: "SCHEDULED",
        createdBy: admin.id,
      },
    });
    console.log(
      `seeded ${tier} drop (10 packs, starts ${startsAt.toISOString()}, ends ${endsAt.toISOString()})`,
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
