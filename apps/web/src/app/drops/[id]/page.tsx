import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DropDetail, type DropDetailData } from "@/components/drop-detail";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deriveStatus } from "@/lib/drop-status";
import { formatMoney } from "@/lib/money";
import { RARITY_WEIGHTS, TIER_PRICES_USD } from "@/lib/rarity-weights";

export const dynamic = "force-dynamic";

export default async function DropDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;

  const [user, drop] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, balance: true, isAdmin: true },
    }),
    prisma.drop.findUnique({
      where: { id },
      select: {
        id: true,
        packTier: true,
        totalInventory: true,
        remaining: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);
  if (!user) redirect("/login");
  if (!drop) {
    return <NotFound />;
  }

  const initial: DropDetailData = {
    id: drop.id,
    packTier: drop.packTier,
    totalInventory: drop.totalInventory,
    remaining: drop.remaining,
    startsAt: drop.startsAt.toISOString(),
    endsAt: drop.endsAt.toISOString(),
    status: deriveStatus(drop),
  };

  const weights = RARITY_WEIGHTS[drop.packTier];
  const publishedOdds = {
    COMMON: (weights.COMMON * 100).toFixed(2),
    UNCOMMON: (weights.UNCOMMON * 100).toFixed(2),
    RARE: (weights.RARE * 100).toFixed(2),
    EPIC: (weights.EPIC * 100).toFixed(2),
    LEGENDARY: (weights.LEGENDARY * 100).toFixed(2),
  };
  const price = Number(TIER_PRICES_USD[drop.packTier]).toFixed(2);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader email={user.email} balance={formatMoney(user.balance)} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <Link
          href="/drops"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← All drops
        </Link>
        <DropDetail
          initial={initial}
          userBalanceUsd={formatMoney(user.balance)}
          priceUsd={price}
          publishedOddsPct={publishedOdds}
        />
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold">Drop not found</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          It may have been removed. Head back to{" "}
          <Link href="/drops" className="underline">
            the drops list
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

