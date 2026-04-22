import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DropsList, type DropSummary } from "@/components/drops-list";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deriveStatus } from "@/lib/drop-status";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DropsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, balance: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const drops = await prisma.drop.findMany({
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      packTier: true,
      totalInventory: true,
      remaining: true,
      startsAt: true,
      endsAt: true,
    },
  });
  const initial: DropSummary[] = drops.map((d) => ({
    id: d.id,
    packTier: d.packTier,
    totalInventory: d.totalInventory,
    remaining: d.remaining,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    status: deriveStatus(d),
  }));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pack drops</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Limited-inventory drops. Buy early — they sell out.
          </p>
        </div>
        <DropsList initial={initial} />
      </main>
    </div>
  );
}
