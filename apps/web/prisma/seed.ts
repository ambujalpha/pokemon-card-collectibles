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
