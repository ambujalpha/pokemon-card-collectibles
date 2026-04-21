import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
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
    select: { email: true, balance: true },
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
      <Header email={user.email} balance={formatMoney(user.balance)} />
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

function Header({ email, balance }: { email: string; balance: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="font-semibold tracking-tight">
          PullVault
        </Link>
        <Link href="/drops" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Drops
        </Link>
        <Link
          href="/me/packs"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          My packs
        </Link>
      </nav>
      <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="tabular-nums">${balance}</span>
        <span>{email}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
